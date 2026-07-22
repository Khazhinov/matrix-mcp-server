import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";

/**
 * Disk-persisted cache of already key-backup-restored megolm sessions, keyed
 * by (roomId, sessionId). One megolm session typically covers many messages
 * before rotating - without this, every undecryptable event would repeat the
 * full backup-restore round trip (account-data fetches, backup version fetch,
 * per-session download, BackupDecryptionKey.decryptV1) even when the session
 * was already restored moments (or container restarts) earlier.
 *
 * Deliberately a separate, self-owned SQLite database (via Node's built-in
 * node:sqlite, no extra native dependency) rather than an attempt to write
 * into the OlmMachine's own store - neither the persistent nodejs OlmMachine
 * nor the ephemeral wasm one expose any API to insert an externally-decrypted
 * session (see backupRestore.ts's own comments) - so this cache stores plain
 * decrypted session-export JSON ourselves and re-imports it into a fresh wasm
 * OlmMachine on each read, skipping only the network/decrypt steps.
 */

const databases = new Map<string, DatabaseSync>();

function getDb(cryptoStorePath: string): DatabaseSync {
  let database = databases.get(cryptoStorePath);
  if (!database) {
    fs.mkdirSync(cryptoStorePath, { recursive: true });
    const dbPath = path.join(cryptoStorePath, "backup-session-cache.sqlite3");
    database = new DatabaseSync(dbPath);
    database.exec(`
      CREATE TABLE IF NOT EXISTS decrypted_sessions (
        room_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        session_data TEXT NOT NULL,
        cached_at INTEGER NOT NULL,
        PRIMARY KEY (room_id, session_id)
      )
    `);
    databases.set(cryptoStorePath, database);
  }
  return database;
}

export function getCachedDecryptedSession(
  cryptoStorePath: string,
  roomId: string,
  sessionId: string
): Record<string, any> | null {
  const database = getDb(cryptoStorePath);
  const row = database
    .prepare("SELECT session_data FROM decrypted_sessions WHERE room_id = ? AND session_id = ?")
    .get(roomId, sessionId) as { session_data: string } | undefined;
  return row ? JSON.parse(row.session_data) : null;
}

export function cacheDecryptedSession(
  cryptoStorePath: string,
  roomId: string,
  sessionId: string,
  sessionData: Record<string, any>
): void {
  const database = getDb(cryptoStorePath);
  database
    .prepare(
      "INSERT OR REPLACE INTO decrypted_sessions (room_id, session_id, session_data, cached_at) VALUES (?, ?, ?, ?)"
    )
    .run(roomId, sessionId, JSON.stringify(sessionData), Date.now());
}
