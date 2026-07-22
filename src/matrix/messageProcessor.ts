import * as sdk from "matrix-js-sdk";
import { MatrixClient, EventType } from "matrix-js-sdk";
import type { OlmMachine } from "@matrix-org/matrix-sdk-crypto-nodejs";
import fetch from "node-fetch";
import { decryptMatrixEvent } from "./crypto/messageCrypto.js";

/**
 * Represents a processed message that can be returned to MCP clients
 */
export type ProcessedMessage =
  | { type: "text"; text: string; undecryptable?: boolean }
  | { type: "image"; data: string; mimeType: string };

/** Format an already-decrypted (or always-plaintext) m.room.message content into a ProcessedMessage. */
async function formatRoomMessageContent(
  content: Record<string, any>,
  matrixClient: MatrixClient
): Promise<ProcessedMessage | null> {
  if (content.msgtype === "m.text") {
    return {
      type: "text",
      text: String(content.body || ""),
    };
  } else if (content.msgtype === "m.image" && content.url) {
    try {
      const httpUrl = String(matrixClient.mxcUrlToHttp(content.url) || "");
      const response = await fetch(httpUrl);

      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      const base64Data = Buffer.from(buffer).toString("base64");

      return {
        type: "image",
        data: base64Data,
        mimeType: String(content.info?.mimetype || "application/octet-stream"),
      };
    } catch (error: any) {
      console.error(`Failed to fetch image content: ${error.message}`);
      return null;
    }
  }
  return null;
}

/**
 * Processes a Matrix event and extracts relevant content
 *
 * @param event - Matrix event to process
 * @param matrixClient - Matrix client instance for fetching additional data
 * @param olmMachine - E2EE sidecar for this account, if available (null if not bootstrapped/disabled)
 * @returns Promise<ProcessedMessage | null> - Processed message or null if not processable
 */
export async function processMessage(
  event: sdk.MatrixEvent,
  matrixClient: MatrixClient | null,
  olmMachine: OlmMachine | null = null
): Promise<ProcessedMessage | null> {
  if (!matrixClient) {
    throw new Error("Matrix client is not initialized.");
  }

  if (event.getType() === "m.room.encrypted") {
    if (!olmMachine) {
      return {
        type: "text",
        text: "[Unable to decrypt message: no E2EE session available for this account]",
        undecryptable: true,
      };
    }
    const roomId = event.getRoomId();
    const result = await decryptMatrixEvent(olmMachine, event, roomId ?? "");
    if (!result.ok) {
      return {
        type: "text",
        text: `[Unable to decrypt message: ${result.reason}]`,
        undecryptable: true,
      };
    }
    if (result.type !== EventType.RoomMessage) {
      return null;
    }
    return formatRoomMessageContent(result.content, matrixClient);
  }

  const content = event.getContent();
  if (event.getType() === EventType.RoomMessage && content) {
    return formatRoomMessageContent(content, matrixClient);
  }

  return null;
}

/**
 * Filters and processes messages within a date range
 *
 * @param events - Array of Matrix events
 * @param startDate - Start date string
 * @param endDate - End date string
 * @param matrixClient - Matrix client instance
 * @param olmMachine - E2EE sidecar for this account, if available
 * @returns Promise<ProcessedMessage[]> - Array of processed messages
 */
export async function processMessagesByDate(
  events: sdk.MatrixEvent[],
  startDate: string,
  endDate: string,
  matrixClient: MatrixClient,
  olmMachine: OlmMachine | null = null
): Promise<ProcessedMessage[]> {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();

  const filteredEvents = events.filter((event) => {
    const timestamp = event.getTs();
    return timestamp >= start && timestamp <= end;
  });

  const messages = await Promise.all(
    filteredEvents.map((event) => processMessage(event, matrixClient, olmMachine))
  );

  return messages.filter((message) => message !== null) as ProcessedMessage[];
}

/**
 * Counts messages by user in a room
 *
 * @param events - Array of Matrix events
 * @param limit - Maximum number of users to return
 * @returns Array of user message counts
 */
export function countMessagesByUser(
  events: sdk.MatrixEvent[],
  limit: number = 10
): Array<{ userId: string; count: number }> {
  const userMessageCounts: Record<string, number> = {};

  events
    .filter((event) => event.getType() === EventType.RoomMessage || event.getType() === "m.room.encrypted")
    .forEach((event) => {
      const sender = event.getSender();
      if (sender) {
        userMessageCounts[sender] = (userMessageCounts[sender] || 0) + 1;
      }
    });

  return Object.entries(userMessageCounts)
    .sort(([, countA], [, countB]) => countB - countA)
    .slice(0, limit)
    .map(([userId, count]) => ({ userId, count }));
}
