import { MatrixEvent } from "matrix-js-sdk";
import { OlmMachine, RoomId } from "@matrix-org/matrix-sdk-crypto-nodejs";

export type DecryptResult =
  | { ok: true; type: string; content: Record<string, any> }
  | { ok: false; reason: string };

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
