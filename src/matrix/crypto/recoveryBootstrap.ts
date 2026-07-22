import { MatrixClient } from "matrix-js-sdk";
import { OlmMachine } from "@matrix-org/matrix-sdk-crypto-nodejs";

/**
 * One-time (idempotent) cross-signing trust bootstrap via the account's
 * Secure Secret Storage (4S) recovery key. Milestone 3 - real import logic
 * lands here; for now this only reports current status and is a safe no-op
 * without MATRIX_RECOVERY_KEY. Never throws - see CLAUDE.md error-handling
 * rules (a failed bootstrap must not prevent the rest of the sidecar from
 * working).
 */
export async function bootstrapCrossSigningIfNeeded(client: MatrixClient, olmMachine: OlmMachine): Promise<void> {
  try {
    const status = await olmMachine.crossSigningStatus();
    if (status.hasMaster && status.hasSelfSigning && status.hasUserSigning) {
      return;
    }
    if (!process.env.MATRIX_RECOVERY_KEY) {
      console.warn(
        "E2EE: MATRIX_RECOVERY_KEY not set - device will not be cross-signing-trusted. " +
          "Encrypted send/receive still works; recipients may see this as an unverified session."
      );
      return;
    }
    // Milestone 3: fetch m.secret_storage.*/m.cross_signing.* account-data,
    // SecretStorageKey.fromAccountData(...), importSecretsFromSecretStorage(...),
    // upload the resulting SignatureUploadRequest. Not yet implemented.
    console.warn("E2EE: MATRIX_RECOVERY_KEY is set but bootstrap is not yet implemented (Milestone 3).");
  } catch (error) {
    console.warn(`E2EE: cross-signing bootstrap check failed (non-fatal): ${error}`);
  }
}
