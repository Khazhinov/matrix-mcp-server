import { MatrixClient, Method } from "matrix-js-sdk";
import { OlmMachine, DeviceLists } from "@matrix-org/matrix-sdk-crypto-nodejs";

// Mirrors the `RequestType` const enum from @matrix-org/matrix-sdk-crypto-nodejs.
// Re-declared as plain numeric constants because `const enum` imports are
// incompatible with this project's `isolatedModules: true` tsconfig setting.
const RequestType = {
  KeysUpload: 0,
  KeysQuery: 1,
  KeysClaim: 2,
  ToDevice: 3,
  SignatureUpload: 4,
  RoomMessage: 5,
  KeysBackup: 6,
} as const;

/**
 * Drain and dispatch OlmMachine's outgoing requests (key upload/query/claim,
 * to-device sends, signature uploads). One failed request never aborts the
 * loop or propagates - see CLAUDE.md for why (cache-teardown-on-throw risk).
 */
export async function drainOutgoingRequests(client: MatrixClient, olmMachine: OlmMachine): Promise<void> {
  const requests = await olmMachine.outgoingRequests();
  for (const request of requests) {
    try {
      const response = await dispatchRequest(client, request);
      await olmMachine.markRequestAsSent(request.id, request.type, JSON.stringify(response ?? {}));
      // A KeysUpload response's one_time_key_counts must be fed straight
      // back, or OlmMachine can believe the server-side count is still
      // stale/low and re-generate an overlapping batch of one-time keys on
      // the very next drain, which the homeserver then rejects as
      // "already exists" (observed during Milestone 2 testing).
      if (request.type === RequestType.KeysUpload && response?.one_time_key_counts) {
        await olmMachine.receiveSyncChanges("[]", new DeviceLists(), response.one_time_key_counts, []);
      }
    } catch (error) {
      console.warn(`E2EE: failed to dispatch outgoing request ${request.id} (type ${request.type}): ${error}`);
    }
  }
}

/** Dispatch a single OlmMachine request to the homeserver, returning its raw JSON response. */
async function dispatchRequest(client: MatrixClient, request: any): Promise<any> {
  switch (request.type) {
    case RequestType.KeysUpload:
      return client.http.authedRequest(Method.Post, "/keys/upload", undefined, JSON.parse(request.body));
    case RequestType.KeysQuery:
      return client.http.authedRequest(Method.Post, "/keys/query", undefined, JSON.parse(request.body));
    case RequestType.KeysClaim:
      return client.http.authedRequest(Method.Post, "/keys/claim", undefined, JSON.parse(request.body));
    case RequestType.SignatureUpload:
      return client.http.authedRequest(Method.Post, "/keys/signatures/upload", undefined, JSON.parse(request.body));
    case RequestType.ToDevice: {
      const { messages } = JSON.parse(request.body) as { messages: Record<string, Record<string, any>> };
      const contentMap = new Map<string, Map<string, any>>();
      for (const [userId, deviceMap] of Object.entries(messages ?? {})) {
        contentMap.set(userId, new Map(Object.entries(deviceMap)));
      }
      return client.sendToDevice(request.eventType, contentMap, request.txnId);
    }
    case RequestType.RoomMessage:
      return client.sendEvent(request.roomId, request.eventType, JSON.parse(request.body), request.txnId);
    default:
      console.warn(`E2EE: unhandled outgoing request type ${request.type}`);
      return undefined;
  }
}
