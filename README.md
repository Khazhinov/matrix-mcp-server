# Matrix MCP Server

> **Fork notice**: This is a fork of [mjknowles/matrix-mcp-server](https://github.com/mjknowles/matrix-mcp-server). The upstream repository's main branch has been inactive since mid-2025 with no maintainer response to open issues. This fork restores active development - including full end-to-end encryption (E2EE) support - and will evolve independently of upstream going forward.

A comprehensive **Model Context Protocol (MCP) server** that provides secure access to Matrix homeserver functionality. Built with TypeScript, this server enables MCP clients to interact with Matrix rooms, messages, users, and more through a standardized interface.

## Features

- 🔐 **OAuth 2.0 Authentication** with token exchange support
- 🔒 **End-to-End Encryption (E2EE)** - send and read messages in encrypted rooms, including full history via key-backup restore
- 📱 **15 Matrix Tools** organized by functionality tiers
- 🏠 **Multi-homeserver Support** with configurable endpoints
- 🔄 **Real-time Operations** with ephemeral client management
- 🚀 **Production Ready** with comprehensive error handling
- 📊 **Rich Responses** with detailed Matrix data

## Quick Start

### Prerequisites

- **Node.js 24+** and npm (required by the E2EE dependency, `@matrix-org/matrix-sdk-crypto-nodejs`)
- **Matrix homeserver** access (Synapse, Dendrite, etc.)
- **MCP client** (Claude Desktop, VS Code with MCP extension, etc.)
- **Docker** (recommended for deployment - see [Docker Deployment](#docker-deployment) below)

### Installation (local, no Docker)

```bash
# Clone the repository
git clone <repository-url>
cd matrix-mcp-server

# Install dependencies
npm install

# Build the project
npm run build

# Configure environment
cp .env.example .env
# Edit .env with your settings - see "Environment Variables" below

# Start the server
npm start
```

### Development Mode

```bash
# Start with hot reload (OAuth disabled for easier testing)
npm run dev

# Or start with OAuth enabled
ENABLE_OAUTH=true npm run dev
```

## Docker Deployment

Recommended for production or any multi-service setup. The included `Dockerfile` is a multi-stage build (`node:24-alpine`, build stage runs `tsc`, runtime stage installs production dependencies only).

```bash
docker build -t matrix-mcp-server .
docker run -d \
  --name matrix-mcp-server \
  --env-file .env \
  -e HOST=0.0.0.0 \
  -p 3000:3000 \
  matrix-mcp-server
```

Or via `docker-compose.yml`:

```yaml
services:
  matrix-mcp-server:
    build: .
    restart: always
    env_file:
      - .env
    environment:
      - HOST=0.0.0.0
      - PORT=3000
      - ENABLE_OAUTH=false
      - ENABLE_TOKEN_EXCHANGE=false
      - ENABLE_HTTPS=false
      - MATRIX_CRYPTO_STORE_PATH=/data/crypto-store
    ports:
      - "127.0.0.1:3000:3000"
    volumes:
      - matrix-crypto-store:/data/crypto-store

volumes:
  matrix-crypto-store:
```

**Why `HOST=0.0.0.0` matters**: by default the server binds to `127.0.0.1` (loopback only). Inside a container, or behind a reverse proxy in a separate container (e.g. one that injects Matrix credential headers - see [Deploying behind a reverse proxy](#deploying-behind-a-reverse-proxy-recommended-for-shared-hosting) below), that makes the server unreachable from anything outside its own container's network namespace. Set `HOST=0.0.0.0` whenever the server needs to be reached from another container or host.

**Never delete the `matrix-crypto-store` volume carelessly** (`docker compose down -v` or a stray `docker volume rm`). It holds the server's persistent E2EE device identity and cross-signing trust. Losing it means the bot reappears in Matrix as a brand-new, unverified device, and any megolm sessions established purely in memory are gone (key-backup restore, if configured, still works after volume loss - see [End-to-End Encryption](#end-to-end-encryption-e2ee) below).

## Available Tools

### 📖 Tier 0: Read-Only Tools

#### **Room Tools**

- **`list-joined-rooms`** - Get all rooms the user has joined

  - _No parameters required_
  - Returns room names, IDs, and member counts

- **`get-room-info`** - Get detailed room information

  - `roomId` (string): Matrix room ID (e.g., `!roomid:domain.com`)
  - Returns name, topic, settings, creator, encryption status, and member count

- **`get-room-members`** - List all members in a room
  - `roomId` (string): Matrix room ID
  - Returns display names and user IDs of joined members

#### **Message Tools**

- **`get-room-messages`** - Retrieve recent messages from a room

  - `roomId` (string): Matrix room ID
  - `limit` (number, default: 20): Maximum messages to retrieve
  - Returns formatted message content including text and images
  - Transparently decrypts messages in encrypted rooms (see [E2EE](#end-to-end-encryption-e2ee))

- **`get-messages-by-date`** - Filter messages by date range

  - `roomId` (string): Matrix room ID
  - `startDate` (string): ISO 8601 format (e.g., `2024-01-01T00:00:00Z`)
  - `endDate` (string): ISO 8601 format
  - Returns messages within the specified timeframe

- **`identify-active-users`** - Find most active users by message count
  - `roomId` (string): Matrix room ID
  - `limit` (number, default: 10): Maximum users to return
  - Returns users ranked by message activity

#### **User Tools**

- **`get-user-profile`** - Get profile information for any user

  - `targetUserId` (string): Target user's Matrix ID (e.g., `@user:domain.com`)
  - Returns display name, avatar, presence, and shared rooms

- **`get-my-profile`** - Get your own profile information

  - _No parameters required_
  - Returns your profile, device info, and room statistics

- **`get-all-users`** - List all users known to your client
  - _No parameters required_
  - Returns display names and user IDs from client cache

#### **Search Tools**

- **`search-public-rooms`** - Discover public rooms to join
  - `searchTerm` (string, optional): Filter by name or topic
  - `server` (string, optional): Specific server to search
  - `limit` (number, default: 20): Maximum rooms to return
  - Returns room details, topics, and member counts

#### **Notification Tools**

- **`get-notification-counts`** - Check unread messages and mentions

  - `roomFilter` (string, optional): Specific room ID to check
  - Returns unread counts, mentions, and recent activity

- **`get-direct-messages`** - List all DM conversations
  - `includeEmpty` (boolean, default: false): Include DMs with no recent messages
  - Returns DM partners, last messages, and unread status

### ✏️ Tier 1: Action Tools

#### **Messaging Tools**

- **`send-message`** - Send messages to rooms

  - `roomId` (string): Matrix room ID
  - `message` (string): Message content
  - `messageType` (enum: "text" | "html" | "emote", default: "text"): Message formatting
  - `replyToEventId` (string, optional): Event ID to reply to
  - Supports plain text, HTML formatting, and emote actions
  - Transparently encrypts if the room requires it (see [E2EE](#end-to-end-encryption-e2ee))

- **`send-direct-message`** - Send private messages to users
  - `targetUserId` (string): Target user's Matrix ID
  - `message` (string): Message content
  - Automatically creates DM rooms if needed (always encrypted, per Matrix/Element convention)

#### **Room Management Tools**

- **`create-room`** - Create new Matrix rooms

  - `roomName` (string): Name for the new room
  - `isPrivate` (boolean, default: false): Room privacy setting
  - `topic` (string, optional): Room topic/description
  - `inviteUsers` (array, optional): User IDs to invite initially
  - `roomAlias` (string, optional): Human-readable room alias
  - `encrypted` (boolean, default: false): Enable end-to-end encryption (`m.megolm.v1.aes-sha2`) for the room
  - Creates rooms with appropriate security settings

- **`join-room`** - Join rooms by ID or alias

  - `roomIdOrAlias` (string): Room ID or alias to join
  - Works with invitations and public rooms

- **`leave-room`** - Leave Matrix rooms

  - `roomId` (string): Room ID to leave
  - `reason` (string, optional): Reason for leaving
  - Cleanly exits rooms with optional reason

- **`invite-user`** - Invite users to rooms
  - `roomId` (string): Room to invite user to
  - `targetUserId` (string): User ID to invite
  - Respects room permissions and power levels

#### **Room Administration Tools**

- **`set-room-name`** - Update room display names

  - `roomId` (string): Room to modify
  - `roomName` (string): New room name
  - Requires appropriate room permissions

- **`set-room-topic`** - Update room topics/descriptions
  - `roomId` (string): Room to modify
  - `topic` (string): New room topic
  - Requires appropriate room permissions

## End-to-End Encryption (E2EE)

This fork adds full E2EE support on top of upstream, using **two independent crypto engines**, each solving a different part of the problem:

| Engine | Package | Purpose | Storage |
|---|---|---|---|
| Primary | `@matrix-org/matrix-sdk-crypto-nodejs` (native Rust binding) | Device identity, cross-signing, sending, decrypting messages received while the device exists | Persistent SQLite (`MATRIX_CRYPTO_STORE_PATH`) |
| History fallback | `@matrix-org/matrix-sdk-crypto-wasm` (the same binding `matrix-js-sdk`/Element use) | Restoring one specific session from server-side key backup to decrypt messages sent *before* this device existed | None - pure in-memory, created and discarded per lookup |

**Why two engines?** `matrix-js-sdk`'s own built-in crypto (`initRustCrypto()`) has no supported way to persist device identity in Node.js - this is an open, maintainer-confirmed limitation upstream ([matrix-org/matrix-js-sdk#4769](https://github.com/matrix-org/matrix-js-sdk/issues/4769)). This fork instead drives `@matrix-org/matrix-sdk-crypto-nodejs` directly for a real, persistent SQLite-backed identity. That package, however, has no API to import room keys from anywhere (confirmed by reading its full source) - so for the one case that needs it (restoring history), this fork falls back to the WASM binding used by Element, in a throwaway in-memory instance (no IndexedDB - not needed, and not available in Node anyway).

### Setup

1. **Use a dedicated Matrix device/access token - never your own daily-driver Element session.**

   This is not a suggestion, it's a hard requirement: the server runs its own independent Olm/Megolm crypto engine under whatever `device_id` your `MATRIX_ACCESS_TOKEN` belongs to. If that token is the same device as an actively-used Element client, the two crypto engines will fight over the same device identity - you'll see errors like `one time key ... already exists` when uploading keys, and the *real* Element session may stop being able to decrypt its own messages.

   Get a dedicated token via a fresh login (same account, new device):

   ```bash
   curl -s -X POST 'https://YOUR-HOMESERVER/_matrix/client/v3/login' \
     -H 'Content-Type: application/json' \
     -d '{
       "type": "m.login.password",
       "identifier": {"type": "m.id.user", "user": "your-username"},
       "password": "YOUR-PASSWORD",
       "initial_device_display_name": "MCP Server Bot"
     }'
   ```

   The response contains `access_token` and `device_id` - use `access_token` as `MATRIX_ACCESS_TOKEN`. **Run this command in your own terminal, never inside an AI coding assistant/agent session** - the password would end up in that session's transcript/logs.

2. **Get your account's Secure Secret Storage (4S) recovery key** for `MATRIX_RECOVERY_KEY`. In Element: **Settings -> Security & Privacy -> Secure Backup**. If one is already set up, you can view/re-display the recovery key there; if not, set up Secure Backup first (Element will generate one for you). This key is used for two things:
   - **Cross-signing bootstrap**: makes the bot's device cryptographically signed by your account's identity (affects the "verified" indicator other clients show for it - not required for sending/receiving to work, but recommended).
   - **History restore**: without it, the server can still send and receive *new* messages in encrypted rooms, but cannot decrypt anything sent before it first joined a room's session (a normal Matrix limitation for any new device - see [Known Limitations](#known-limitations)).

3. **Add both to your `.env`**:

   ```bash
   MATRIX_E2EE_ENABLED=true
   MATRIX_CRYPTO_STORE_PATH=/data/crypto-store
   MATRIX_RECOVERY_KEY=your-recovery-key-here
   ```

4. Restart the server. On first run it will upload device keys and (if `MATRIX_RECOVERY_KEY` is set) attempt cross-signing bootstrap - check the logs for `E2EE: cross-signing bootstrap succeeded` or a specific warning if something's missing.

### History Pagination

`get-room-messages` and `get-messages-by-date` only operate on whatever's already loaded into the room's local timeline (bounded by `initialSyncLimit` plus anything received live since) - by default that never reaches further back on its own, **regardless of encryption**, an unencrypted room's very old history is equally invisible until paginated. Both tools now call `client.scrollback()` as needed before reading the timeline (`src/matrix/historyPagination.ts`), capped at 20 pagination requests per call as a safety bound against pathologically large full-room walks. Combined with key-backup restore, this means a fresh `MATRIX_RECOVERY_KEY`-configured deployment can retrieve messages from the very start of a room's history, not just from whenever this server first joined it.

Decrypted-session lookups performed during history restore are cached to a small SQLite database next to `MATRIX_CRYPTO_STORE_PATH` (`src/matrix/crypto/sessionCache.ts`, via Node's built-in `node:sqlite` - no extra native dependency) - one megolm session typically covers many messages, so this avoids repeating the full backup-restore network round trip for every single historical message that shares a session.

### Known Limitations

- **The "Unverified" shield in Element may not clear even when everything is working correctly.** Cross-signing bootstrap can be cryptographically complete and confirmed (checked directly via `/keys/query`) while some Element sessions still show the device as unverified - this has been observed to be Element-client-side trust-state caching, not a signal that something is broken. It does not block sending or receiving.
- **A device that never received a room's session key, and isn't covered by key backup, cannot be recovered.** If `MATRIX_RECOVERY_KEY` isn't set, or key backup was never enabled on the account, history from before this device joined a room will show as `[Unable to decrypt message: ...]` - this mirrors what any brand-new Matrix device experiences without backup restore, it is not specific to this server.
- **`get-room-messages` does not currently render `m.emote` message content** (pre-existing gap, inherited from before this fork's E2EE work - out of scope for the encryption effort specifically).
- **MCP clients typically cache each tool's parameter schema for the lifetime of a session/connection.** If you upgrade this server and a tool gains a new parameter (e.g. `create-room`'s `encrypted`), reconnect your MCP client (restart the session) before using the new parameter - otherwise the client-side schema cache will reject it as an unrecognized/mistyped field even though the server supports it correctly.
- **Building the Docker image requires outbound network access to GitHub**, not just the npm registry - `@matrix-org/matrix-sdk-crypto-nodejs`'s `postinstall` script fetches its prebuilt native binary directly from GitHub Releases rather than via npm's `optionalDependencies` mechanism. If your build environment restricts egress to the npm registry only, this step will fail.
- **Pagination is capped at 20 `scrollback()` calls per request** (`historyPagination.ts`) - an extremely large gap between what's loaded and the requested date range (e.g. querying a multi-year-old date in a very high-traffic room for the first time) may need more than one tool call to fully reach.

## Authentication & Configuration

### Authentication Modes

The server supports two authentication modes:

#### OAuth Mode (`ENABLE_OAUTH=true`)

- Full OAuth 2.0 integration with your identity provider
- Supports token exchange for Matrix homeserver authentication
- Secure multi-user access with proper token management
- Recommended for production deployments

#### Development Mode (`ENABLE_OAUTH=false`)

- Direct access without OAuth authentication
- Requires Matrix access token and user ID as headers (`matrix_access_token`, `matrix_user_id`, `matrix_homeserver_url`) - see [Deploying behind a reverse proxy](#deploying-behind-a-reverse-proxy-recommended-for-shared-hosting)
- Simplified setup for testing and development
- **Not recommended for production without a reverse proxy injecting these headers server-side** (see below) - otherwise every MCP client configuration must carry the raw access token

### Deploying behind a reverse proxy (recommended for shared hosting)

In `ENABLE_OAUTH=false` mode, every tool call authenticates via the `matrix_access_token`/`matrix_user_id`/`matrix_homeserver_url` HTTP headers - the server never reads these from a config file itself. If you're hosting this for others to use (not just yourself locally), don't put the raw access token in each user's MCP client config. Instead, run this server behind a reverse proxy (nginx, Caddy, etc.) that injects those three headers from its own trusted secret store, so the token never has to be typed into or stored by any MCP client. Example nginx snippet:

```nginx
server {
    listen 8090;
    location /mcp {
        proxy_pass http://matrix-mcp-server:3000/mcp;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header matrix_access_token "YOUR_TOKEN_HERE";
        proxy_set_header matrix_user_id "@user:example.com";
        proxy_set_header matrix_homeserver_url "https://matrix.example.com";
    }
}
```

MCP clients then just point at the proxy's URL (e.g. `http://127.0.0.1:8090/mcp`) with no headers of their own.

### Environment Variables

Create a `.env` file with your configuration:

```bash
# Core Configuration
PORT=3000
HOST=127.0.0.1                       # Set to 0.0.0.0 in Docker / behind a reverse proxy in another container
ENABLE_OAUTH=true                    # Enable OAuth authentication
ENABLE_TOKEN_EXCHANGE=true           # Exchange OAuth tokens for Matrix tokens
CORS_ALLOWED_ORIGINS=""              # Comma-separated allowed origins (empty = allow all)

# HTTPS Configuration (optional)
ENABLE_HTTPS=false
SSL_KEY_PATH="/path/to/private.key"
SSL_CERT_PATH="/path/to/certificate.crt"

# Identity Provider (OAuth mode)
IDP_ISSUER_URL="https://keycloak.example.com/realms/matrix"
IDP_AUTHORIZATION_URL="https://keycloak.example.com/realms/matrix/protocol/openid-connect/auth"
IDP_TOKEN_URL="https://keycloak.example.com/realms/matrix/protocol/openid-connect/token"
OAUTH_CALLBACK_URL="http://localhost:3000/callback"

# Matrix Configuration
MATRIX_HOMESERVER_URL="https://matrix.example.com"
MATRIX_DOMAIN="matrix.example.com"
MATRIX_CLIENT_ID="your-matrix-client-id"
MATRIX_CLIENT_SECRET="your-matrix-client-secret"

# End-to-End Encryption - see "End-to-End Encryption (E2EE)" section above
MATRIX_E2EE_ENABLED=true             # Set to "false" to disable E2EE entirely (encrypted-room sends will then fail with a clear error)
MATRIX_CRYPTO_STORE_PATH=/data/crypto-store
MATRIX_RECOVERY_KEY="your-4s-recovery-key"
```

## Client Integration

### Claude Code

Remember, the `MATRIX_ACCESS_TOKEN` header is an optional header. You should delete it if you have token exchange working. Obtain `MATRIX_MCP_TOKEN` from MCP Inspector.

```bash
claude mcp add --transport http matrix-server http://localhost:3000/mcp -H "matrix_user_id:  @user1:matrix.example.com" -H "matrix_homeserver_url: https://localhost:8008" -H "matrix_access_token: ${MATRIX_ACCESS_TOKEN}" -H "Authorization: Bearer ${MATRIX_MCP_TOKEN}"
```

### VS Code

Remember, the `matrix_access_token` header is an optional header. You should delete it if you have token exchange working.

In mcp.json:

```json
{
  "servers": {
    "matrix-mcp": {
      "url": "http://localhost:3000/mcp",
      "type": "http",
      "headers": {
        "matrix_access_token": "${input:matrix-access-token}",
        "matrix_user_id": "@<your-matrix-username>:<your-homeserver-domain>",
        "matrix_homeserver_url": "<your-homeserver-url>"
      }
    }
  },
  "inputs": [
    {
      "id": "matrix-access-token",
      "type": "promptString",
      "description": "Your OAuth access token"
    }
  ]
}
```

### Testing with MCP Inspector

```bash
# Start the server
npm run dev

# In another terminal, run the inspector
npx @modelcontextprotocol/inspector
```

Connect to `http://localhost:3000/mcp` to authenticate and test all available tools.

## Development

### Available Scripts

```bash
npm run build      # Build TypeScript to dist/
npm run dev        # Development server with hot reload
npm run start      # Production server
npm run lint       # Run ESLint
npm run test       # Run tests
```

### Project Structure

```
src/
├── http-server.ts           # Main HTTP server entry point
├── server.ts               # MCP server configuration
├── tools/                  # Tool implementations
│   ├── tier0/             # Read-only tools
│   │   ├── rooms.ts       # Room information tools
│   │   ├── messages.ts    # Message retrieval tools
│   │   ├── users.ts       # User profile tools
│   │   ├── search.ts      # Room search tools
│   │   └── notifications.ts # Notification tools
│   └── tier1/             # Action tools
│       ├── messaging.ts   # Message sending tools
│       ├── room-management.ts # Room lifecycle tools
│       └── room-admin.ts  # Room administration tools
├── matrix/                # Matrix client management
│   ├── client.ts          # Client creation/caching, E2EE sidecar bootstrap
│   ├── clientCache.ts      # Per-account client + crypto sidecar cache
│   ├── messageProcessor.ts # Message formatting, encrypted-event decrypt branch
│   ├── historyPagination.ts # scrollback()-based pagination for older-than-loaded history
│   └── crypto/             # E2EE implementation (see "End-to-End Encryption" above)
│       ├── olmMachineManager.ts    # Persistent OlmMachine lifecycle
│       ├── outgoingRequestDrain.ts # Dispatches OlmMachine's outgoing requests
│       ├── syncGlue.ts             # Feeds to-device events into OlmMachine
│       ├── deviceTracking.ts       # Device tracking + megolm session sharing
│       ├── messageCrypto.ts        # encrypt/decrypt entry points
│       ├── recoveryBootstrap.ts    # Cross-signing bootstrap via 4S recovery key
│       ├── backupRestore.ts        # History restore via key backup (ephemeral WASM engine)
│       └── sessionCache.ts         # Disk cache of already-restored session keys
├── utils/                 # Helper utilities
└── types/                 # TypeScript type definitions
```

## Security Considerations

- 🔐 **Token Management**: All Matrix clients are ephemeral and cleaned up after operations
- 🛡️ **OAuth Integration**: Prevents direct Matrix token exposure through OAuth proxy
- 🔒 **E2EE**: Encrypted-room sends refuse to fall back to plaintext if the crypto engine isn't available - see [End-to-End Encryption](#end-to-end-encryption-e2ee)
- 🔍 **Permission Checks**: Respects Matrix room power levels and permissions
- 🚫 **Input Validation**: Comprehensive parameter validation using Zod schemas
- 🌐 **CORS Support**: Configurable origin restrictions for web clients

## Architecture

The server implements a three-layer architecture:

1. **HTTP Layer** (`http-server.ts`): Express server with OAuth integration
2. **MCP Layer** (`server.ts`): Tool registration and request routing
3. **Matrix Layer** (`tools/`, `matrix/`): Matrix homeserver communication and E2EE

Each tool creates ephemeral Matrix clients that authenticate via your configured method, perform the requested operation, and clean up automatically. E2EE state (device identity, cross-signing trust) persists across requests and container restarts via the `matrix/crypto/` module - see [End-to-End Encryption](#end-to-end-encryption-e2ee).

## License

This project is licensed under the MIT License - see the LICENSE file for details.
