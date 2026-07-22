# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a Matrix MCP (Model Context Protocol) server implemented in TypeScript that provides secure access to Matrix homeserver functionality. The server acts as a bridge between MCP clients and Matrix homeservers, implementing OAuth 2.0 token exchange with Keycloak for authentication, and full end-to-end encryption (E2EE) for encrypted rooms.

This is a fork of [mjknowles/matrix-mcp-server](https://github.com/mjknowles/matrix-mcp-server) (upstream inactive since mid-2025). It evolves independently of upstream - do not assume upstream's README/CLAUDE.md/issues reflect this repository's current state.

## Core Architecture

### HTTP Server Layer (`src/http-server.ts`)

- Express-based HTTP server exposing MCP endpoints
- OAuth 2.0 integration with Keycloak authentication provider
- Proxy OAuth provider for token verification and client management
- Serves on `PORT` (default 3000), binds to `HOST` (default `127.0.0.1` - set to `0.0.0.0` in Docker/behind a reverse proxy in another container, otherwise the server is unreachable from outside its own container's network namespace)
- `/mcp` endpoint for MCP communication

### MCP Server Implementation (`src/server.ts`)

- Core MCP server with Matrix-specific tools
- Implements token exchange flow with Keycloak for Matrix authentication
- Provides tools for Matrix operations: room listing, message retrieval, member management, sending, encryption
- Each tool creates ephemeral Matrix clients (cached per-account, 15-minute sliding TTL - see `src/matrix/clientCache.ts`) that authenticate via token exchange or direct header-based token

### Authentication Flow (`src/verifyAccessToken.ts`)

- JWT token verification using Keycloak's JWKS endpoint
- Fetches user information from Keycloak userinfo endpoint
- Handles self-signed certificates for local development

### Request Routing (`src/routes.ts`, `src/route-handlers.ts`)

- Simple Express router handling POST requests for MCP communication
- Uses StreamableHTTPServerTransport for MCP protocol handling
- Returns 405 for non-POST methods

### E2EE (`src/matrix/crypto/`)

Two independent crypto engines, each solving a different problem - **do not conflate them when modifying this code**:

- **`olmMachineManager.ts`, `outgoingRequestDrain.ts`, `syncGlue.ts`, `deviceTracking.ts`, `messageCrypto.ts`, `recoveryBootstrap.ts`** - built on `@matrix-org/matrix-sdk-crypto-nodejs` (native Rust binding, persistent SQLite store at `MATRIX_CRYPTO_STORE_PATH`). Owns device identity, cross-signing, sending, and decrypting anything the device has a live megolm session for. One `CryptoSidecar` per cache key (`userId:homeserverUrl`), stored alongside the `MatrixClient` in `clientCache.ts` and disposed at the same 5 (now 6, including the crypto teardown) teardown call sites.
- **`backupRestore.ts`** - built on `@matrix-org/matrix-sdk-crypto-wasm` (the binding `matrix-js-sdk`/Element use), invoked only as a fallback when the primary engine can't decrypt an event. Restores exactly the one needed session from the account's server-side key backup (via `MATRIX_RECOVERY_KEY`) into a throwaway, **in-memory-only** WASM `OlmMachine` (no `store_name` passed - confirmed to avoid touching IndexedDB entirely, which doesn't exist in Node anyway), decrypts, and discards the instance.

**Why not just use `matrix-js-sdk`'s own `initRustCrypto()`?** No supported way to persist device identity in Node - open, maintainer-confirmed limitation upstream ([matrix-org/matrix-js-sdk#4769](https://github.com/matrix-org/matrix-js-sdk/issues/4769)). `@matrix-org/matrix-sdk-crypto-nodejs` gives real persistence but has zero API surface for importing room keys from anywhere (checked exhaustively across all of its source files) - hence the second, WASM-based engine for the one case that needs importing (history restore).

**Non-negotiable error-handling rule**: every one of the 15 tool handlers calls `removeClientFromCache()` on any thrown error, which tears down the entire cached client (and now its crypto sidecar). `decryptMatrixEvent`/`decryptViaBackupRestore` must never throw - decrypt failures return `{ok: false, reason}` and degrade to a `[Unable to decrypt message: ...]` text placeholder. `sendMatrixMessage` is the one deliberate exception: it throws if a room is encrypted but no crypto sidecar is available, rather than silently sending plaintext into an encrypted room.

See `README.md`'s "End-to-End Encryption (E2EE)" section for setup/operational details (dedicated device requirement, recovery key acquisition, known limitations).

## Development Commands

```bash
# Install dependencies
npm install

# Build TypeScript to dist/
npm run build

# Development server with hot reload (no OAuth)
npm run dev

# Development server with OAuth enabled
ENABLE_OAUTH=true npm run dev

# Production server
npm start

# Production server with OAuth
ENABLE_OAUTH=true npm start

# Linting
npm run lint

# Testing
npm test
```

**Node.js 24+ is required** (`@matrix-org/matrix-sdk-crypto-nodejs`'s engines field) - not the 18/20 that older upstream docs may reference.

## Matrix Tools Available

The server provides 15 MCP tools (see `README.md` for the full parameter reference per tool). Every tool handler reads Matrix identity/credentials from HTTP headers on each request, **never as MCP tool parameters**:

- `matrix_access_token` - direct Matrix access token (non-OAuth mode)
- `matrix_user_id` - full Matrix user ID (e.g. `@username:domain.com`)
- `matrix_homeserver_url` - homeserver base URL

(`src/utils/server-helpers.ts::getAccessToken`/`getMatrixContext` read these headers; `ENABLE_OAUTH=true` mode instead derives the equivalent from the verified OAuth bearer token via token exchange.) **Do not reintroduce these as tool-level parameters** - doing so would mean every MCP tool-call payload carries the raw credential, defeating the point of header-based injection (e.g. via a reverse proxy that keeps the token out of client config entirely - see `README.md`).

## Configuration Notes

- The server is IDP-agnostic and can work with any OAuth 2.0 provider (Keycloak, Auth0, Okta, etc.)
- Default configuration is set up for Keycloak but can be customized via environment variables
- Matrix client credentials are configurable via environment variables
- All HTTPS requests use `rejectUnauthorized: false` for local development
- `MATRIX_E2EE_ENABLED=false` disables the E2EE crypto sidecar entirely at client-creation time (fast rollback switch) - encrypted-room sends then fail with a clear error instead of attempting encryption

## Environment Variables

### Core Configuration

- `PORT`: Server port (default: 3000)
- `HOST`: Bind address (default: `127.0.0.1`; use `0.0.0.0` in Docker/behind a reverse proxy in a different container)
- `ENABLE_OAUTH`: Set to "true" to enable OAuth authentication flow. When disabled, the MCP endpoint is accessible without authentication
- `ENABLE_TOKEN_EXCHANGE`: Set to "true" to exchange the access token used to access this MCP server for one from the Matrix client in your IdP (assuming both this mcp server and your homeserver share the same IDP)
- `CORS_ALLOWED_ORIGINS`: Comma-separated list of allowed origins for CORS. Leave empty for development (allows all origins). For production, specify allowed domains (e.g., "https://yourdomain.com,https://app.yourdomain.com")

### HTTPS Configuration

- `ENABLE_HTTPS`: Set to "true" to enable HTTPS, "false" for HTTP (default: false for development)
- `SSL_KEY_PATH`: Path to SSL private key file (required when ENABLE_HTTPS=true)
- `SSL_CERT_PATH`: Path to SSL certificate file (required when ENABLE_HTTPS=true)

### Identity Provider Configuration (OAuth mode only)

- `IDP_ISSUER_URL`: OAuth issuer URL (default: Keycloak localhost)
- `IDP_AUTHORIZATION_URL`: OAuth authorization endpoint
- `IDP_TOKEN_URL`: OAuth token endpoint
- `IDP_REGISTRATION_URL`: OAuth client registration endpoint
- `IDP_REVOCATION_URL`: OAuth token revocation endpoint
- `OAUTH_CALLBACK_URL`: OAuth callback URL (default: http://localhost:3000/callback)
- `MCP_SERVER_URL`: MCP server base URL (default: http://localhost:3000/mcp)

### Matrix Configuration

- `MATRIX_HOMESERVER_URL`: Matrix homeserver URL (default: https://localhost:8008/)
- `MATRIX_DOMAIN`: Matrix domain (default: matrix.example.com)
- `MATRIX_CLIENT_ID`: Matrix client ID for token exchange
- `MATRIX_CLIENT_SECRET`: Matrix client secret for token exchange

### End-to-End Encryption

- `MATRIX_E2EE_ENABLED`: Set to "false" to disable E2EE entirely (default: enabled)
- `MATRIX_CRYPTO_STORE_PATH`: Directory for the persistent SQLite crypto store (default: `/data/crypto-store` - mount a volume here in Docker, never delete it carelessly)
- `MATRIX_RECOVERY_KEY`: The account's Secure Secret Storage (4S) recovery key - used for cross-signing bootstrap and key-backup-based history restore. See `README.md` for how to obtain it and why the underlying access token **must** belong to a dedicated device, not an actively-used Element session.

A `.env` file is provided with sensible defaults. Copy and modify as needed for your environment.

## Token Exchange Flow (OAuth Mode Only)

When `ENABLE_OAUTH=true` and `ENABLE_TOKEN_EXCHANGE=true`:

1. MCP client provides initial OAuth token
2. Server exchanges token with Keycloak using client credentials
3. Exchanged token used for Matrix homeserver authentication
4. Matrix client created with exchanged access token
5. Matrix operations performed, then client cleaned up

When OAuth is disabled, the server bypasses authentication entirely - this is experimental and intended for development/testing only, or for deployment behind a reverse proxy that injects the three Matrix headers itself (see `README.md`).

## Testing with MCP Inspector

```bash
# Start development server without OAuth (simpler for testing)
npm run dev

# OR start with OAuth enabled
ENABLE_OAUTH=true npm run dev

# In separate terminal, run MCP inspector
npx @modelcontextprotocol/inspector
```

Connect to `http://localhost:3000/mcp`. With OAuth disabled, no authentication is required. With OAuth enabled, you'll need to authenticate through the OAuth flow.

## Security Considerations

- All Matrix client instances are cached per-account (15-minute sliding TTL) and cleaned up on eviction/error, including their E2EE crypto sidecar
- OAuth token exchange prevents direct Matrix token exposure
- User identification derived from email in JWT token (OAuth mode) or from the `matrix_user_id` header (non-OAuth mode)
- Local development uses self-signed certificates (not for production)
- `sendMatrixMessage` refuses (throws) rather than silently sending plaintext into a room that requires encryption when no crypto sidecar is available - see "E2EE" above
