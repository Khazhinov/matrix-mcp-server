import { MatrixClient, MatrixEvent, ISendEventResponse } from "matrix-js-sdk";
import { OlmMachine, RoomId } from "@matrix-org/matrix-sdk-crypto-nodejs";
import { prepareRoomForEncryption } from "./deviceTracking.js";

export type DecryptResult =
  | { ok: true; type: string; content: Record<string, any> }
  | { ok: false; reason: string };

/**
 * Send a room message, encrypting first if the room requires it. Refuses
 * (throws) rather than silently falling back to plaintext if the room is
 * encrypted but no olmMachine is available - see CLAUDE.md security rules.
 */
export async function sendMatrixMessage(
  client: MatrixClient,
  olmMachine: OlmMachine | null,
  roomId: string,
  content: Record<string, any>
): Promise<ISendEventResponse> {
  const room = client.getRoom(roomId);
  const isEncrypted = room?.hasEncryptionStateEvent() ?? false;

  if (!isEncrypted) {
    return client.sendEvent(roomId, "m.room.message" as any, content as any);
  }

  if (!olmMachine) {
    throw new Error(
      "This room is encrypted, but no E2EE session is available for this account - refusing to send in plaintext."
    );
  }

  await prepareRoomForEncryption(client, olmMachine, roomId);
  const encryptedContentJson = await olmMachine.encryptRoomEvent(new RoomId(roomId), "m.room.message", JSON.stringify(content));
  return client.sendEvent(roomId, "m.room.encrypted" as any, JSON.parse(encryptedContentJson));
}

/** Decrypt a single m.room.encrypted timeline event. Never throws - callers get {ok:false} on failure. */
export async function decryptMatrixEvent(
  olmMachine: OlmMachine,
  event: MatrixEvent,
  roomId: string
): Promise<DecryptResult> {
  try {
    const rawEvent = JSON.stringify(event.getEffectiveEvent());
    const decrypted = await olmMachine.decryptRoomEvent(rawEvent, new RoomId(roomId));
    const parsed = JSON.parse(decrypted.event);
    return { ok: true, type: parsed.type, content: parsed.content ?? {} };
  } catch (error) {
    return { ok: false, reason: String(error) };
  }
}
