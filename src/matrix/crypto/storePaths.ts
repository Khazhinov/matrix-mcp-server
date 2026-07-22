import { createHash } from "crypto";
import path from "path";

const DEFAULT_BASE_PATH = "/data/crypto-store";

/**
 * Deterministic, per-cache-key SQLite store directory for OlmMachine.
 * Same cache key (userId:homeserverUrl) always resolves to the same path,
 * so the identity persists across client recreation and container restarts.
 */
export function cryptoStorePathForKey(cacheKey: string): string {
  const basePath = process.env.MATRIX_CRYPTO_STORE_PATH || DEFAULT_BASE_PATH;
  const hash = createHash("sha256").update(cacheKey).digest("hex").slice(0, 32);
  return path.join(basePath, hash);
}
