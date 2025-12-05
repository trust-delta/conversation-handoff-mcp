# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
