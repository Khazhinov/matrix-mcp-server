import { MatrixClient } from "matrix-js-sdk";
import { OlmMachine, UserId, RoomId, EncryptionSettings } from "@matrix-org/matrix-sdk-crypto-nodejs";
import { drainOutgoingRequests, dispatchAndMarkSent } from "./outgoingRequestDrain.js";

/**
 * Ensures device lists are tracked, missing Olm sessions are claimed, and a
 * megolm session is shared with every joined member - called before every
 * encrypted send (idempotent: no-ops if OlmMachine already has a fresh,
 * fully-shared session and no device-list changes since last call).
 */
export async function prepareRoomForEncryption(client: MatrixClient, olmMachine: OlmMachine, roomId: string): Promise<void> {
  const room = client.getRoom(roomId);
  if (!room) {
    throw new Error(`Room ${roomId} not found - cannot prepare encryption.`);
  }
  const memberIds = room.getJoinedMembers().map((member) => new UserId(member.userId));

  await olmMachine.updateTrackedUsers(memberIds);
  await drainOutgoingRequests(client, olmMachine);

  const claimRequest = await olmMachine.getMissingSessions(memberIds);
  if (claimRequest) {
    await dispatchAndMarkSent(client, olmMachine, claimRequest);
  }

  const shareRequests = await olmMachine.shareRoomKey(new RoomId(roomId), memberIds, new EncryptionSettings());
  for (const request of shareRequests) {
    await dispatchAndMarkSent(client, olmMachine, request);
  }
}
