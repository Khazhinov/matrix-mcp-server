import { MatrixClient, MatrixEvent, Method } from "matrix-js-sdk";
import {
  OlmMachine as WasmOlmMachine,
  UserId as WasmUserId,
  DeviceId as WasmDeviceId,
  RoomId as WasmRoomId,
  BackupDecryptionKey,
  DecryptionSettings,
  TrustRequirement,
} from "@matrix-org/matrix-sdk-crypto-wasm";
// SecretStorageKey doesn't exist in the wasm package (matrix-js-sdk implements
// 4S decryption itself in pure JS instead) - reuse the nodejs binding's
// implementation, which is a pure computation with no store dependency.
import { SecretStorageKey } from "@matrix-org/matrix-sdk-crypto-nodejs";
import type { DecryptResult } from "./messageCrypto.js";
import { getCachedDecryptedSession, cacheDecryptedSession } from "./sessionCache.js";

/**
 * Fallback decrypt path for events the persistent (nodejs) OlmMachine can't
 * decrypt (typically: history from before this device existed). Restores the
 * single needed session from the account's server-side key backup, using an
 * ephemeral, in-memory-only WASM OlmMachine (no IndexedDB - store_name is
 * intentionally omitted, confirmed to work standalone in Node). Discarded
 * after use; never persists any crypto engine state. Never throws.
 *
 * The already-decrypted session-export data itself IS cached to disk (see
 * sessionCache.ts) - one megolm session covers many messages, so without this
 * every undecryptable event in the same session would repeat the full
 * network+decrypt round trip.
 */
export async function decryptViaBackupRestore(
  client: MatrixClient,
  event: MatrixEvent,
  roomId: string,
  cryptoStorePath: string
): Promise<DecryptResult> {
  let wasmMachine: WasmOlmMachine | undefined;
  try {
    const content = event.getWireContent();
    const sessionId: string | undefined = content?.session_id;
    if (!sessionId) {
      return { ok: false, reason: "encrypted event has no session_id - cannot look up backup" };
    }

    let exportedKey = getCachedDecryptedSession(cryptoStorePath, roomId, sessionId);

    if (!exportedKey) {
      const recoveryKeyInput = process.env.MATRIX_RECOVERY_KEY?.replace(/\s+/g, "");
      if (!recoveryKeyInput) {
        return { ok: false, reason: "MATRIX_RECOVERY_KEY not set - cannot restore from key backup" };
      }

      const defaultKeyData = await client.getAccountDataFromServer("m.secret_storage.default_key");
      if (!defaultKeyData?.key) {
        return { ok: false, reason: "no m.secret_storage.default_key account-data found" };
      }
      const keyId = defaultKeyData.key;
      const keyEventType = `m.secret_storage.key.${keyId}` as const;
      const keyDescription = await client.getAccountDataFromServer(keyEventType);
      if (!keyDescription) {
        return { ok: false, reason: `no account-data found for ${keyEventType}` };
      }
      const secretStorageKey = SecretStorageKey.fromAccountData(
        recoveryKeyInput,
        keyEventType,
        JSON.stringify(keyDescription)
      );

      const backupSecretInfo = await client.getAccountDataFromServer("m.megolm_backup.v1");
      if (!backupSecretInfo) {
        return { ok: false, reason: "no m.megolm_backup.v1 secret in account-data - key backup not set up" };
      }
      const backupKeyBase64 = secretStorageKey.decrypt(JSON.stringify(backupSecretInfo), "m.megolm_backup.v1");
      const backupDecryptionKey = BackupDecryptionKey.fromBase64(backupKeyBase64);

      const backupVersionInfo: any = await client.http.authedRequest(Method.Get, "/room_keys/version");
      const version = backupVersionInfo.version;

      const sessionInfo: any = await client.http.authedRequest(
        Method.Get,
        `/room_keys/keys/${encodeURIComponent(roomId)}/${encodeURIComponent(sessionId)}`,
        { version }
      );
      const { ephemeral, mac, ciphertext } = sessionInfo.session_data;
      const decryptedSessionJson = backupDecryptionKey.decryptV1(ephemeral, mac, ciphertext);
      const sessionData: Record<string, any> = JSON.parse(decryptedSessionJson);

      exportedKey = {
        room_id: roomId,
        session_id: sessionId,
        ...sessionData,
      };
      cacheDecryptedSession(cryptoStorePath, roomId, sessionId, exportedKey);
    }

    wasmMachine = await WasmOlmMachine.initialize(
      new WasmUserId(client.getUserId() as string),
      new WasmDeviceId("HISTORY-READER")
    );
    await wasmMachine.importExportedRoomKeys(JSON.stringify([exportedKey]), () => {});

    const rawEvent = JSON.stringify(event.getEffectiveEvent());
    const decryptionSettings = new DecryptionSettings(TrustRequirement.Untrusted);
    const decrypted = await wasmMachine.decryptRoomEvent(rawEvent, new WasmRoomId(roomId), decryptionSettings);
    const parsedEvent = JSON.parse(decrypted.event);
    return { ok: true, type: parsedEvent.type, content: parsedEvent.content ?? {} };
  } catch (error) {
    return { ok: false, reason: String(error) };
  } finally {
    wasmMachine?.free();
  }
}
