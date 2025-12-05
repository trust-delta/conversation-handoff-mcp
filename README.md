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

## Shared Server Mode (v0.3.0+)

Share handoffs across multiple MCP clients (Claude Desktop, Claude Code, etc.) using HTTP server mode.

### Operating Modes

Starting with v0.3.0, MCP clients check for a local server (`localhost:1099`) **on each request**:

| Status | Behavior |
|--------|----------|
| Server is running | Shared mode (handoffs are shared) |
| Server is not running | Standalone mode (with warning) |
| `HANDOFF_SERVER=none` | Standalone mode (no warning) |

**Dynamic mode switching:**
- Start a server later → Automatically switches to shared mode on next request
- Server goes down → Falls back to standalone on next request
- Data saved in standalone mode is preserved across mode switches

### Standalone Mode Limitations

In standalone mode, handoff data is stored in the MCP server process memory.

**What works:**
- Handoffs between conversations/projects within the same app (e.g., between different projects in Claude Desktop)

**What doesn't work:**
- Handoffs between different apps (e.g., Claude Desktop → Claude Code)
- Handoffs between different processes

To share handoffs across multiple MCP clients, start a shared server.

### Starting the Shared Server

```bash
# Default port (1099)
npx conversation-handoff-mcp --serve

# Custom port
npx conversation-handoff-mcp --serve --port 3000
```

### MCP Client Configuration

**Standard configuration (recommended)** - Auto-connects if server is available:

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

**Specify custom server:**

```json
{
  "mcpServers": {
    "conversation-handoff": {
      "command": "npx",
      "args": ["-y", "conversation-handoff-mcp"],
      "env": {
        "HANDOFF_SERVER": "http://localhost:3000"
      }
    }
  }
}
```

**Always use standalone mode (never use shared server):**

```json
{
  "mcpServers": {
    "conversation-handoff": {
      "command": "npx",
      "args": ["-y", "conversation-handoff-mcp"],
      "env": {
        "HANDOFF_SERVER": "none"
      }
    }
  }
}
```

### HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /handoff | Save a handoff |
| GET | /handoff | List all handoffs |
| GET | /handoff/:key | Load a specific handoff |
| DELETE | /handoff/:key | Delete a specific handoff |
| DELETE | /handoff | Delete all handoffs |
| GET | /stats | Get storage statistics |
| GET | / | Health check |

### Workflow Example

1. Start the shared server:
   ```bash
   npx conversation-handoff-mcp --serve
   ```

2. In Claude Desktop, save a handoff:
   ```
   handoff_save(key: "my-task", title: "My Task", summary: "...", conversation: "...")
   ```

3. In Claude Code (or another client), load the handoff:
   ```
   handoff_load(key: "my-task")
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
