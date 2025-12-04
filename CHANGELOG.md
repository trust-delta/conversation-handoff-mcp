# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
