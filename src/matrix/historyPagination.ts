import { MatrixClient, Room, Direction } from "matrix-js-sdk";

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_ITERATIONS = 20;

/**
 * `room.getLiveTimeline().getEvents()` only contains whatever was loaded by
 * the initial sync (initialSyncLimit in client.ts) plus anything received
 * live since - it never reaches further back on its own. Both get-room-messages
 * and get-messages-by-date only read that in-memory snapshot, so a request
 * for older history than what's currently loaded silently returns nothing,
 * regardless of encryption/backup-restore (confirmed on both encrypted and
 * unencrypted rooms). These helpers page further back via scrollback() before
 * the caller reads the timeline.
 */

/** Paginate backward until at least `minCount` events are loaded, or history is exhausted. */
export async function ensureMinimumEventCount(
  client: MatrixClient,
  room: Room,
  minCount: number,
  maxIterations: number = DEFAULT_MAX_ITERATIONS
): Promise<void> {
  for (let i = 0; i < maxIterations; i++) {
    if (room.getLiveTimeline().getEvents().length >= minCount) {
      return;
    }
    const paginationToken = room.getLiveTimeline().getPaginationToken(Direction.Backward);
    if (paginationToken === null && i > 0) {
      return; // reached the start of the room's history
    }
    try {
      await client.scrollback(room, DEFAULT_BATCH_SIZE);
    } catch (error) {
      console.warn(`History pagination failed for room ${room.roomId}: ${error}`);
      return;
    }
  }
}

/** Paginate backward until the oldest loaded event predates `targetTimestampMs`, or history is exhausted. */
export async function ensureHistoryBefore(
  client: MatrixClient,
  room: Room,
  targetTimestampMs: number,
  maxIterations: number = DEFAULT_MAX_ITERATIONS
): Promise<void> {
  for (let i = 0; i < maxIterations; i++) {
    const events = room.getLiveTimeline().getEvents();
    const oldestEvent = events[0];
    if (oldestEvent && oldestEvent.getTs() <= targetTimestampMs) {
      return; // already loaded back far enough to cover the requested range
    }
    const paginationToken = room.getLiveTimeline().getPaginationToken(Direction.Backward);
    if (paginationToken === null && i > 0) {
      return; // reached the start of the room's history
    }
    try {
      await client.scrollback(room, DEFAULT_BATCH_SIZE);
    } catch (error) {
      console.warn(`History pagination failed for room ${room.roomId}: ${error}`);
      return;
    }
  }
}
