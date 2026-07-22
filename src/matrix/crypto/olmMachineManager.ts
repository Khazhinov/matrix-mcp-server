import fs from "fs";
import { MatrixClient } from "matrix-js-sdk";
import { OlmMachine, UserId, DeviceId } from "@matrix-org/matrix-sdk-crypto-nodejs";

// Mirrors the `StoreType` const enum from @matrix-org/matrix-sdk-crypto-nodejs
// (Sqlite = 0, its only variant) - see outgoingRequestDrain.ts for why this
// isn't imported directly (isolatedModules incompatibility with const enum).
const STORE_TYPE_SQLITE = 0;
import { cryptoStorePathForKey } from "./storePaths.js";
import { drainOutgoingRequests } from "./outgoingRequestDrain.js";
import { registerSyncGlue } from "./syncGlue.js";
import { bootstrapCrossSigningIfNeeded } from "./recoveryBootstrap.js";
import type { CryptoSidecar } from "./types.js";

/**
 * Create (or open an existing persistent) OlmMachine for this cache key,
 * upload its device keys, register sync-glue listeners, and best-effort
 * bootstrap cross-signing trust. Never throws in a way that should prevent
 * MatrixClient creation - callers (client.ts) already wrap this in try/catch.
 */
export async function getOrCreateCryptoSidecar(
  client: MatrixClient,
  userId: string,
  deviceId: string,
  homeserverUrl: string,
  cacheKey: string
): Promise<CryptoSidecar> {
  const storePath = cryptoStorePathForKey(cacheKey);
  fs.mkdirSync(storePath, { recursive: true });

  const olmMachine = await OlmMachine.initialize(
    new UserId(userId),
    new DeviceId(deviceId),
    storePath,
    null,
    STORE_TYPE_SQLITE
  );

  const syncHandlers = registerSyncGlue(client, olmMachine);

  // Uploads this device's own identity/one-time keys on first run; no-op on
  // subsequent runs against the same persistent store. Routed through
  // syncHandlers.run() so it shares one serialization queue with the sync-glue
  // listeners - outgoingRequests()/markRequestAsSent() must not overlap.
  await syncHandlers.run(() => drainOutgoingRequests(client, olmMachine));

  const sidecar: CryptoSidecar = {
    olmMachine,
    userId,
    deviceId,
    homeserverUrl,
    cacheKey,
    storePath,
    disposed: false,
    syncHandlers,
  };

  // Best-effort - failure here must not prevent the sidecar (and therefore
  // the MatrixClient) from being usable for encrypt/decrypt.
  await bootstrapCrossSigningIfNeeded(client, olmMachine).catch((error) => {
    console.warn(`E2EE: cross-signing bootstrap failed (non-fatal): ${error}`);
  });

  return sidecar;
}

/** Tear down a sidecar's listeners and close its OlmMachine (releases the SQLite store). */
export function disposeCryptoSidecar(sidecar: CryptoSidecar): void {
  if (sidecar.disposed) return;
  sidecar.disposed = true;
  try {
    sidecar.syncHandlers?.unregister();
  } catch (error) {
    console.warn(`E2EE: error unregistering sync-glue for ${sidecar.userId}: ${error}`);
  }
  try {
    sidecar.olmMachine.close();
  } catch (error) {
    console.warn(`E2EE: error closing OlmMachine for ${sidecar.userId}: ${error}`);
  }
}
