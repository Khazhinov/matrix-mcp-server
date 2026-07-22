import type { OlmMachine } from "@matrix-org/matrix-sdk-crypto-nodejs";

/**
 * Per-cache-key E2EE state, stored alongside the MatrixClient in clientCache.ts
 * so it shares the exact same lifetime/teardown semantics.
 */
export interface CryptoSidecar {
  olmMachine: OlmMachine;
  userId: string;
  deviceId: string;
  homeserverUrl: string;
  cacheKey: string;
  storePath: string;
  disposed: boolean;
  syncHandlers: { unregister: () => void; run: (fn: () => Promise<void>) => Promise<void> } | null;
}
