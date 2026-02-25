# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.1] - 2026-02-25

### Changed

- **Module refactoring**: Split large source files into focused single-responsibility modules
  - `index.ts` (803→80 lines) → `cli.ts`, `tools.ts`, `index.ts`
  - `storage.ts` (783→130 lines) → `types.ts`, `local-storage.ts`, `remote-storage.ts`, `storage.ts`
  - `validation.ts` (373→250 lines) → `config.ts`, `validation.ts`
  - Backward compatibility preserved via re-exports (no import changes needed for consumers)
- `RemoteStorage` reconnection now uses dependency injection (`reconnectFn`) for better testability
- Updated CLAUDE.md architecture documentation to reflect new file structure

## [0.9.0] - 2026-02-25

### Added

- **`handoff_restart` Tool**: Restart the shared HTTP server from any MCP client
  - Sends graceful shutdown request to the running server, then auto-starts a new one
  - Solves the problem of needing to kill all clients or manually find the process after a package update
  - Progress notifications during restart (checking → shutting down → starting)
  - Returns error message when running in standalone mode (no server to restart)
- `POST /shutdown` HTTP endpoint for graceful server shutdown
- 1 new test (total: 155)

## [0.8.0] - 2026-02-22

### Added

- **`format` Parameter for `handoff_save`**: Choose between structured and verbatim conversation saving
  - `"structured"` (default): Organized template format — reduces AI output tokens to ~5-20% of the original conversation, significantly faster
  - `"verbatim"`: Complete word-for-word conversation saving for cases where exact wording matters
  - Structured template includes sections: Key Decisions, Implementation Details, Code Changes, Open Issues, Next Steps
  - Server-side processing unchanged — `format` guides AI generation behavior only
- **MCP Progress Notifications**: `handoff_save` and `handoff_merge` now send progress updates via `notifications/progress`
  - Clients that support `progressToken` will see step-by-step progress (connecting, saving/merging, complete)
  - No-op for clients that don't request progress — fully backward compatible

### Changed

- **`Buffer.byteLength` Deduplication**: Eliminated redundant byte size calculations in save flow
  - `ValidationResult` now carries pre-calculated `inputSizes` (summaryBytes, conversationBytes)
  - `StorageResult` passes validation metadata through to callers
  - Audit logging reuses validation sizes instead of recalculating (falls back to recalculation for RemoteStorage)
- **CLAUDE.md**: Updated project documentation with architecture diagram, domain knowledge, and directory structure

## [0.7.1] - 2026-02-20

### Added

- **MCP Apps UI Dark Mode**: System preference-based light/dark theme support
  - Uses `prefers-color-scheme` media query to follow OS setting automatically
  - All hardcoded dark colors replaced with CSS custom properties
  - Light mode: clean white/gray palette; Dark mode: retains original dark palette
  - Accent colors adjusted for proper contrast in both modes

## [0.7.0] - 2026-02-11

### Added

- **`--audit` Mode**: Structured JSONL audit logging for development diagnostics
  - Enable with `--audit` / `-a` flag or `HANDOFF_AUDIT=true` environment variable
  - Logs to `/tmp/conversation-handoff-mcp/` as JSONL files
  - Records: tool calls (timing, input sizes), storage events (FIFO deletions, merges), connection events (port scans, server lifecycle), HTTP requests, and periodic performance snapshots (60s)
  - File rotation: 10MB per file, up to 5 rotated files
  - Zero overhead when disabled (no-op functions)
  - New `src/audit.ts` module with `AuditLogger` class
  - 25 new tests (total: 148)

## [0.6.1] - 2026-02-08

### Changed

- `handoff_save` のツール説明文・パラメータ説明文を強化し、AIが会話を要約せず全文（verbatim）保存するよう改善

### Security

- `@modelcontextprotocol/sdk` を 1.25.3 → 1.26.0 に更新（GHSA-345p-7cg4-v4c7: cross-client data leak 修正）

## [0.6.0] - 2026-02-07

### Added

- **`handoff_merge` Tool**: Merge multiple related handoffs into a single unified handoff
  - Combine conversations from separate sessions into one continuous context
  - Two merge strategies: `chronological` (sorted by creation time) or `sequential` (array order)
  - Auto-generated or custom key/title/summary for merged handoff
  - `delete_sources` option to remove source handoffs after merging
  - Conversations joined with `---` separator and `<!-- Source: key -->` markers
  - Metadata merging: `from_ai`/`from_project` unified when same, comma-joined when different
  - Validation: size limits, duplicate key detection, key collision checks
- `POST /handoff/merge` HTTP endpoint for shared server mode
- `validateMergeInput()` validation function
- Reserved key `"merge"` to prevent conflicts with API routes
- 30 new tests (total: 123)

## [0.5.2] - 2026-02-05

### Added

- **Load Button in MCP Apps UI**: Added "Load" button to handoff list UI for loading conversation context
  - Clicking "Load" inserts handoff content into chat input field
  - User presses Enter to send and continue conversation with full context

### Known Limitations

- **MCP Apps vs Claude Desktop Implementation Gap**: According to MCP Apps specification, `sendMessage` should add messages directly to conversation and trigger model response. However, Claude Desktop's current implementation inserts messages into chat input field instead, requiring user to press Enter. This is expected to improve in future Claude Desktop updates.

## [0.5.1] - 2026-02-04

### Security

- **Cryptographically Secure Key Generation**: Replaced `Math.random()` with `crypto.randomUUID()` for handoff key generation
- **CORS Restriction**: Limited allowed origins to `localhost` and `127.0.0.1` only (previously allowed all origins)
- **Localhost Binding**: HTTP server now binds to `127.0.0.1` instead of all interfaces (prevents network access)
- **HTTP Input Validation**: Added `validateSaveInput()` for type-safe request body validation
- **Fetch Timeout**: Added 30-second timeout to remote storage HTTP requests (prevents DoS via slow responses)
- **Port Scan Rate Limiting**: Limited concurrent port scans to 10 (prevents resource exhaustion)

### Added

- `handoff_load` now returns `structuredContent` in addition to text content
- UI viewer prioritizes `structuredContent` over text parsing (more reliable)
- New test files: `src/autoconnect.test.ts`, `src/server.test.ts`
- New config option: `HANDOFF_FETCH_TIMEOUT` environment variable (default: 30 seconds)

### Changed

- Key format changed from `handoff-YYYYMMDDHHMMSS-[a-z0-9]{6}` to `handoff-YYYYMMDDHHMMSS-[a-f0-9]{8}` (hex characters from UUID)

## [0.5.0] - 2026-01-31

### Added

- **MCP Apps UI**: Interactive handoff list with UI for MCP Apps-compatible clients
  - `handoff_list` now opens interactive UI on compatible clients (falls back to JSON for others)
  - Card-based list view with title, source AI, and date
  - Expandable detail view showing summary and conversation (parsed as User/Assistant messages)
  - Delete button on each card for quick removal
  - Conversation caching to avoid redundant `handoff_load` calls
- **`@modelcontextprotocol/ext-apps` integration**: Uses `registerAppTool` and `registerAppResource`

### Changed

- `handoff_list` upgraded from `server.tool()` to `registerAppTool()` for MCP Apps UI support
- UI built with Vite + vite-plugin-singlefile (bundled as single HTML file)

## [0.4.2] - 2025-12-13

### Added

- **SECURITY.md**: Vulnerability reporting guidelines
- **CONTRIBUTING.md**: Contribution guidelines for developers

### Changed

- Added `exports` field to package.json for explicit ESM support
- Added `npm audit` security check to CI pipeline

## [0.4.1] - 2025-12-11

### Added

- **Flexible Conversation Parsing**: `max_messages` truncation now supports multiple message formats
  - Markdown headers: `## User`, `# User`, `### User`
  - Bold format: `**User:**`, `**Assistant:**`
  - Simple colon: `User:`, `Assistant:`
  - Alternative role names: `Human`, `Claude`, `AI`
  - Case-insensitive matching
- Health check endpoint now includes `version` field in response
- New `splitConversationMessages()` utility function with 11 unit tests

### Changed

- Extracted `sleep()` function to shared utilities (reduced code duplication)

### Fixed

- Test timeout issue in `getStorage` tests (use explicit standalone mode to avoid auto-connect overhead)

## [0.4.0] - 2025-12-08

### Added

- **Auto-Connect Feature**: Server automatically starts and connects without user intervention
  - Automatic server discovery via parallel port scanning (1099-1200, 102 ports)
  - Background server auto-start when no server is running
- **Auto-Reconnection**: Automatic reconnection when server goes down during operation
  - On request failure, automatically rescans ports and restarts server if needed
  - Transparent retry - user sees no errors during reconnection
  - Configurable retry limit via `HANDOFF_RETRY_COUNT` (default: 30)
  - On final failure: outputs pending content for manual recovery
- **Server Auto-Shutdown (TTL)**: Server automatically stops after inactivity
  - Default: 24 hours of no requests
  - Configurable via `HANDOFF_SERVER_TTL` (0 = disabled)
- **Auto-Generated Keys/Titles**: `key` and `title` are now optional in `handoff_save`
  - Auto-generated key format: `handoff-YYYYMMDDHHMMSS-random`
  - Auto-generated title: First 50 characters of summary
- **New Environment Variables**:
  - `HANDOFF_PORT_RANGE`: Port scan range (default: 1099-1200)
  - `HANDOFF_RETRY_COUNT`: Reconnection retry count (default: 30)
  - `HANDOFF_RETRY_INTERVAL`: Reconnection interval in ms (default: 10000)
  - `HANDOFF_SERVER_TTL`: Server auto-shutdown after inactivity (default: 24 hours, 0 = disabled)
- New `autoconnect.ts` module for connection management

### Changed

- **Breaking**: Default behavior changed from standalone to auto-server mode
  - Use `HANDOFF_SERVER=none` to force standalone mode (no server startup)
- Server auto-selects available port if default (1099) is in use
- Removed warning messages for cleaner user experience
- Updated help text with new configuration options

### Design Philosophy

- **Memory-Based Storage**: Handoff data is intentionally stored in memory only
  - No files are written to disk - lightweight temporary clipboard design
  - Data is shared across MCP clients via HTTP server
  - Data is lost when server stops - perfect for session-based context sharing
- **FIFO Auto-Cleanup**: When storage limit is reached, oldest handoff is automatically deleted
  - No error returned to user - seamless experience
  - Updating existing keys doesn't trigger deletion

### Removed

- Standalone mode warnings (silent fallback in v0.4.0+)
- Per-request server health checks (replaced by cached auto-connect)

## [0.3.1] - 2025-12-06

### Security

- **DoS Protection**: Added HTTP body size limit (Content-Length validation + streaming size check)
- **Input Validation**:
  - Proper JSON parse error handling (returns 400 error)
  - `max_messages` query parameter range validation (1-10000)
  - Environment variable NaN protection (invalid values fallback to defaults)
- **URL Validation**: RemoteStorage now only accepts `http://` and `https://` protocols
- **Error Information Leakage Prevention**: Internal error details are no longer exposed to clients

### Fixed

- Improved fetch exception handling (proper error message on JSON parse failure)
- Fixed type error in tests

### Added

- RemoteStorage unit tests (+10 tests, total 56)

### Changed

- vitest v2 → v4 (esbuild vulnerability fix)

## [0.3.0] - 2025-12-06

### Added

- **Dynamic Fallback**: Per-request server availability check with automatic mode switching
  - Server health check on each tool request (not just startup)
  - Automatic fallback from shared to standalone mode when server goes down
  - Automatic reconnection to shared mode when server becomes available
- `HANDOFF_SERVER=none` for explicit standalone mode (no health check, no warnings)
- Singleton LocalStorage to preserve data across mode switches
- Warning message deduplication (only shown on mode change)
- Unit tests for dynamic storage (10 new tests, total 46)

### Changed

- Replaced `createStorage()` with `getStorage()` for per-request dynamic mode selection
- Reduced health check timeout from 1000ms to 500ms for faster fallback
- Updated README with dynamic mode switching documentation
- Added standalone mode limitations documentation

## [0.2.0] - 2025-12-05

### Added

- **Shared Server Mode**: HTTP server mode (`--serve`) for cross-client handoff sharing
  - Multiple MCP clients can share handoffs via HTTP
  - Default port: 1099 (configurable with `--port`)
  - Environment variable `HANDOFF_SERVER` to connect to remote server
- HTTP endpoints:
  - `POST /handoff` - Save a handoff
  - `GET /handoff` - List all handoffs
  - `GET /handoff/:key` - Load a specific handoff
  - `DELETE /handoff/:key` - Delete a specific handoff
  - `DELETE /handoff` - Delete all handoffs
  - `GET /stats` - Get storage statistics
  - `GET /` - Health check
- CLI options: `--serve`, `--port`, `--help`
- Storage abstraction layer (`LocalStorage` / `RemoteStorage`)
- Unit tests for storage layer (16 new tests, total 36)

### Changed

- Refactored codebase into modular structure:
  - `storage.ts` - Storage interface and implementations
  - `server.ts` - HTTP server implementation
  - `index.ts` - Entry point with CLI argument parsing

## [0.1.6] - 2024-12-04

### Changed

- Migrated from deprecated `Server` to `McpServer` API
- Replaced JSON Schema with Zod for input validation
- Replaced ESLint + Prettier with Biome (faster, simpler)
- Refactored validation logic into separate module

### Added

- Unit tests with Vitest (20 tests)
- `npm run test` / `npm run test:watch` commands
- `zod` dependency (was missing)
- GitHub Actions CI workflow (Node 18/20/22)
- English README with Japanese translation
- husky + lint-staged for pre-commit hooks
- Cross-platform `clean` script using rimraf
- npm badges (version, license, CI)

## [0.1.5] - 2024-12-04

### Added

- Environment variable configuration for limits
  - `HANDOFF_MAX_COUNT`: Maximum number of handoffs (default: 100)
  - `HANDOFF_MAX_CONVERSATION_BYTES`: Max conversation size (default: 1MB)
  - `HANDOFF_MAX_SUMMARY_BYTES`: Max summary size (default: 10KB)
  - `HANDOFF_MAX_TITLE_LENGTH`: Max title length (default: 200)
  - `HANDOFF_MAX_KEY_LENGTH`: Max key length (default: 100)
- Input validation for all fields
- `handoff_stats` tool for monitoring storage usage
- ESLint and Prettier configuration
- Proper TypeScript configuration with strict mode

### Changed

- Key format now restricted to alphanumeric, hyphens, and underscores

## [0.1.4] - 2024-12-04

### Added

- LICENSE file (MIT)
- `repository`, `homepage`, `bugs` fields in package.json

## [0.1.3] - 2024-12-04

### Fixed

- npm package now includes dist folder correctly

## [0.1.2] - 2024-12-04

### Added

- Shebang (`#!/usr/bin/env node`) for npm/npx execution
- `files` field in package.json
- `engines` field requiring Node.js >= 18

## [0.1.1] - 2024-12-04

### Added

- `handoff_save`: Save conversation context
- `handoff_list`: List saved handoffs
- `handoff_load`: Load specific handoff
- `handoff_clear`: Clear handoffs

## [0.1.0] - 2024-12-04

### Added

- Initial MCP server setup
- Basic project structure with TypeScript
- stdio transport configuration
