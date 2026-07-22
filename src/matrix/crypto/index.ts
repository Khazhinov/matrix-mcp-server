export type { CryptoSidecar } from "./types.js";
export { getOrCreateCryptoSidecar, disposeCryptoSidecar } from "./olmMachineManager.js";
export { sendMatrixMessage, decryptMatrixEvent } from "./messageCrypto.js";
export type { DecryptResult } from "./messageCrypto.js";
