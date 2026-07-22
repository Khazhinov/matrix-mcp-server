import { MatrixClient, Method } from "matrix-js-sdk";
import { OlmMachine, SecretStorageKey, SecretStorageItems } from "@matrix-org/matrix-sdk-crypto-nodejs";

// Maps the Matrix account-data event type (used to fetch the encrypted
// secret) to the camelCase key SecretStorageItems' Rust constructor expects
// (confirmed by reading matrix-rust-sdk-crypto-nodejs/src/secret_storage.rs -
// it looks up "masterKey"/"userSigningKey"/"selfSigningKey" literally, not
// the account-data event type strings).
const CROSS_SIGNING_SECRETS = [
  { eventType: "m.cross_signing.master", itemsKey: "masterKey" },
  { eventType: "m.cross_signing.self_signing", itemsKey: "selfSigningKey" },
  { eventType: "m.cross_signing.user_signing", itemsKey: "userSigningKey" },
] as const;

/**
 * One-time (idempotent) cross-signing trust bootstrap via the account's
 * Secure Secret Storage (4S) recovery key. Never throws - see CLAUDE.md
 * error-handling rules (a failed bootstrap must not prevent the rest of the
 * sidecar from working); encrypted send/receive does not require this to
 * succeed, only affects whether the device shows as "verified" elsewhere.
 */
export async function bootstrapCrossSigningIfNeeded(client: MatrixClient, olmMachine: OlmMachine): Promise<void> {
  try {
    const status = await olmMachine.crossSigningStatus();
    if (status.hasMaster && status.hasSelfSigning && status.hasUserSigning) {
      return;
    }
    // Element displays the recovery key with spaces every 4 characters for
    // readability; strip them before decoding, in case they were pasted verbatim.
    const recoveryKeyInput = process.env.MATRIX_RECOVERY_KEY?.replace(/\s+/g, "");
    if (!recoveryKeyInput) {
      console.warn(
        "E2EE: MATRIX_RECOVERY_KEY not set - device will not be cross-signing-trusted. " +
          "Encrypted send/receive still works; recipients may see this as an unverified session."
      );
      return;
    }

    const defaultKeyData = await client.getAccountDataFromServer("m.secret_storage.default_key");
    if (!defaultKeyData?.key) {
      console.warn("E2EE: no m.secret_storage.default_key account-data found - cannot bootstrap cross-signing.");
      return;
    }
    const keyId = defaultKeyData.key;
    const keyEventType = `m.secret_storage.key.${keyId}` as const;
    const keyDescription = await client.getAccountDataFromServer(keyEventType);
    if (!keyDescription) {
      console.warn(`E2EE: no account-data found for ${keyEventType} - cannot bootstrap cross-signing.`);
      return;
    }

    const secretStorageKey = SecretStorageKey.fromAccountData(
      recoveryKeyInput,
      keyEventType,
      JSON.stringify(keyDescription)
    );

    const secretsRecord: Record<string, string> = {};
    for (const { eventType, itemsKey } of CROSS_SIGNING_SECRETS) {
      const secretInfo = await client.getAccountDataFromServer(eventType);
      if (!secretInfo) {
        console.warn(`E2EE: no account-data found for ${eventType} - cannot bootstrap cross-signing.`);
        return;
      }
      secretsRecord[itemsKey] = JSON.stringify(secretInfo);
    }
    const items = new SecretStorageItems(secretsRecord);

    // Unlike requests drained via outgoingRequests(), this one is built with
    // an intentionally empty id (matrix-rust-sdk-crypto-nodejs/src/requests.rs,
    // the single-argument TryFrom impl sets request_id = String::new()) - it
    // isn't tracked in OlmMachine's pending-request table, so markRequestAsSent
    // must NOT be called for it (confirmed by source read: doing so produced
    // an internal deserialization error). Just dispatch the HTTP request.
    const signatureUploadRequest = await olmMachine.importSecretsFromSecretStorage(secretStorageKey, items);
    try {
      await client.http.authedRequest(
        Method.Post,
        "/keys/signatures/upload",
        undefined,
        JSON.parse(signatureUploadRequest.body)
      );
    } catch (uploadError) {
      console.warn(`E2EE: failed to upload cross-signing signature (non-fatal): ${uploadError}`);
    }

    const newStatus = await olmMachine.crossSigningStatus();
    if (newStatus.hasMaster && newStatus.hasSelfSigning && newStatus.hasUserSigning) {
      console.log("E2EE: cross-signing bootstrap succeeded - device is now cross-signing-trusted.");
    } else {
      console.warn("E2EE: cross-signing bootstrap ran but status still incomplete - check signature upload response.");
    }
  } catch (error) {
    console.warn(`E2EE: cross-signing bootstrap failed (non-fatal): ${error}`);
  }
}
