import { MatrixClient, ClientEvent, Method } from "matrix-js-sdk";
import { OlmMachine, DeviceLists } from "@matrix-org/matrix-sdk-crypto-nodejs";
import { drainOutgoingRequests } from "./outgoingRequestDrain.js";

const OTK_POLL_THROTTLE_MS = 30_000;

/**
 * Feeds OlmMachine from events the MatrixClient already emits - no
 * independent timer, so disposal is just unregistering these two listeners.
 *
 * - ReceivedToDeviceMessage: available regardless of crypto-backend state
 *   (matrix-js-sdk sync.js handles to_device unconditionally); this is the
 *   path m.room_key/m.forwarded_room_key events arrive on.
 * - Sync (throttled, >=30s apart): compensates for matrix-js-sdk silently
 *   dropping device_lists/one-time-key counts from /sync when no crypto
 *   backend is registered (matrix-org/matrix-js-sdk#4769, confirmed via
 *   source trace) - polls one_time_key_counts via a spec-legal empty
 *   /keys/upload instead.
 *
 * The returned `run` function lets callers outside this module (the initial
 * post-creation drain in olmMachineManager.ts) share the same serialization
 * queue as these listeners - the package's own docs warn that only one such
 * outgoingRequests()/markRequestAsSent() cycle may be in flight at a time.
 */
export function registerSyncGlue(
  client: MatrixClient,
  olmMachine: OlmMachine
): { unregister: () => void; run: (fn: () => Promise<void>) => Promise<void> } {
  let queue: Promise<void> = Promise.resolve();
  let lastOtkPoll = 0;

  const enqueue = (fn: () => Promise<void>): Promise<void> => {
    queue = queue.then(fn).catch((error) => {
      console.warn(`E2EE: sync-glue handler error: ${error}`);
    });
    return queue;
  };

  const onToDevice = (payload: { message: { type: string; content: any; sender: string } }): void => {
    enqueue(async () => {
      const rawEvent = JSON.stringify([payload.message]);
      await olmMachine.receiveSyncChanges(rawEvent, new DeviceLists(), {}, []);
      await drainOutgoingRequests(client, olmMachine);
    });
  };

  const onSync = (state: string): void => {
    if (state !== "SYNCING") return;
    const now = Date.now();
    if (now - lastOtkPoll < OTK_POLL_THROTTLE_MS) return;
    lastOtkPoll = now;
    enqueue(async () => {
      const response: any = await client.http.authedRequest(Method.Post, "/keys/upload", undefined, {});
      const counts = response?.one_time_key_counts ?? {};
      await olmMachine.receiveSyncChanges("[]", new DeviceLists(), counts, []);
      await drainOutgoingRequests(client, olmMachine);
    });
  };

  client.on(ClientEvent.ReceivedToDeviceMessage, onToDevice);
  client.on(ClientEvent.Sync, onSync);

  return {
    unregister: () => {
      client.off(ClientEvent.ReceivedToDeviceMessage, onToDevice);
      client.off(ClientEvent.Sync, onSync);
    },
    run: enqueue,
  };
}
