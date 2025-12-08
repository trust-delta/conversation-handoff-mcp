# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
