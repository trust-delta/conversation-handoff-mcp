# conversation-handoff-mcp

[![npm version](https://img.shields.io/npm/v/conversation-handoff-mcp.svg)](https://www.npmjs.com/package/conversation-handoff-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/trust-delta/conversation-handoff-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/trust-delta/conversation-handoff-mcp/actions/workflows/ci.yml)

MCP server for transferring conversation context between AI chats or different projects within the same AI.

[日本語ドキュメント](README.ja.md)

## Features

- **Memory-based**: Works as a temporary clipboard (cleared on server restart)
- **Common Format**: Human-readable Markdown format
- **Lightweight API**: Returns only summaries when listing to save context

## Installation

### Via npm (Recommended)

```bash
npm install -g conversation-handoff-mcp
```

### Local Build

```bash
git clone https://github.com/trust-delta/conversation-handoff-mcp.git
cd conversation-handoff-mcp
npm install
npm run build
```

## MCP Client Configuration

Works with Claude Desktop, Claude Code, Codex CLI, Gemini CLI, and other MCP clients.

### Configuration File Locations

| Client | Config File |
|--------|-------------|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Code | `~/.claude/settings.json` |
| Codex CLI | `~/.codex/config.toml` |
| Gemini CLI | `~/.gemini/settings.json` |
| Cursor | `~/.cursor/mcp.json` |
| ChatGPT Desktop | In-app settings (Developer Mode) |

### Via npx (No Installation Required)

```json
{
  "mcpServers": {
    "conversation-handoff": {
      "command": "npx",
      "args": ["-y", "conversation-handoff-mcp"]
    }
  }
}
```

### Using Local Build

```json
{
  "mcpServers": {
    "conversation-handoff": {
      "command": "node",
      "args": ["/path/to/conversation-handoff-mcp/dist/index.js"]
    }
  }
}
```

> **Note**: Codex CLI uses TOML format. See [Codex MCP documentation](https://developers.openai.com/codex/mcp/) for details.

## Tools

### handoff_save

Save conversation context.

```text
handoff_save(
  key: "project-design",
  title: "Project Design Discussion",
  summary: "Decided on MCP server design approach",
  conversation: "## User\nQuestion...\n\n## Assistant\nAnswer..."
)
```

### handoff_list

Get list of saved handoffs (summaries only).

```text
handoff_list()
```

### handoff_load

Load full content of a specific handoff.

```text
handoff_load(key: "project-design")
handoff_load(key: "project-design", max_messages: 10)  // Last 10 messages only
```

### handoff_clear

Delete handoffs.

```text
handoff_clear(key: "project-design")  // Specific key
handoff_clear()  // Clear all
```

### handoff_stats

Check storage usage and limits.

```text
handoff_stats()
```

## Configuration

Customize limits via environment variables.

| Variable | Default | Description |
|----------|---------|-------------|
| `HANDOFF_MAX_COUNT` | 100 | Maximum number of handoffs |
| `HANDOFF_MAX_CONVERSATION_BYTES` | 1048576 (1MB) | Maximum conversation size |
| `HANDOFF_MAX_SUMMARY_BYTES` | 10240 (10KB) | Maximum summary size |
| `HANDOFF_MAX_TITLE_LENGTH` | 200 | Maximum title length |
| `HANDOFF_MAX_KEY_LENGTH` | 100 | Maximum key length |

### Configuration Example (Claude Desktop)

```json
{
  "mcpServers": {
    "conversation-handoff": {
      "command": "npx",
      "args": ["-y", "conversation-handoff-mcp"],
      "env": {
        "HANDOFF_MAX_COUNT": "50",
        "HANDOFF_MAX_CONVERSATION_BYTES": "524288"
      }
    }
  }
}
```

## Conversation Format

```markdown
## User
User's message

## Assistant
AI's response
```

## License

MIT

## Author

trust-delta
