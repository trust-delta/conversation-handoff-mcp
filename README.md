# conversation-handoff-mcp

[![npm version](https://img.shields.io/npm/v/conversation-handoff-mcp.svg)](https://www.npmjs.com/package/conversation-handoff-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/trust-delta/conversation-handoff-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/trust-delta/conversation-handoff-mcp/actions/workflows/ci.yml)
[![MCP Apps](https://img.shields.io/badge/MCP_Apps-Ready-blue.svg)](https://github.com/anthropics/mcp-apps)

<a href="https://glama.ai/mcp/servers/@trust-delta/conversation-handoff-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@trust-delta/conversation-handoff-mcp/badge" />
</a>

MCP server for transferring conversation context between AI chats or different projects within the same AI.

[日本語ドキュメント](README.ja.md)

## Features

- **MCP Apps UI (v0.5.0+)**: Interactive UI for browsing and managing handoffs on compatible clients
- **Auto-Connect (v0.4.0+)**: Server automatically starts in the background - no manual setup required
- **Auto-Reconnection (v0.4.0+)**: Seamlessly reconnects when server goes down - no manual intervention needed
- **Memory-Based Storage**: Lightweight temporary clipboard design - no files written to disk
- **Common Format**: Human-readable Markdown format
- **Lightweight API**: Returns only summaries when listing to save context
- **Auto-Generated Keys (v0.4.0+)**: Key and title are now optional in `handoff_save`

## Installation

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

### Via npm (Recommended)

No pre-installation required - runs via npx.

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

For global installation:

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

MCP configuration:

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

Save conversation context. Key and title are auto-generated if omitted (v0.4.0+).

```text
// With explicit key and title
handoff_save(
  key: "project-design",
  title: "Project Design Discussion",
  summary: "Decided on MCP server design approach",
  conversation: "## User\nQuestion...\n\n## Assistant\nAnswer..."
)

// Auto-generated key and title (v0.4.0+)
handoff_save(
  summary: "Decided on MCP server design approach",
  conversation: "## User\nQuestion...\n\n## Assistant\nAnswer..."
)
// → key: "handoff-20241208-143052-abc123" (timestamp + random)
// → title: "Decided on MCP server design approach" (from summary)
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

## MCP Apps UI (v0.5.0+)

For MCP Apps-compatible clients, `handoff_list` automatically opens an interactive UI. Non-compatible clients receive the standard JSON response.

### Features

- **List View**: Card-based list showing title, source AI, and date
- **Detail View**: Expandable cards showing summary and conversation (parsed as User/Assistant messages)
- **Delete**: Remove handoffs directly from UI

## Auto-Connect Mode (v0.4.0+)

Starting with v0.4.0, the server **automatically starts in the background** when an MCP client connects. No manual setup required!

### How It Works

```
[User launches Claude Desktop]
  → MCP client starts
  → Scans ports 1099-1200 in parallel for existing server
  → If no server found: auto-starts one in background
  → Connects to server
  → (User notices nothing - it just works!)

[User launches Claude Code later]
  → MCP client starts
  → Scans ports 1099-1200 in parallel
  → Finds existing server
  → Connects to same server
  → Handoffs are shared!
```

### Operating Modes

| Mode | When | Behavior |
|------|------|----------|
| Auto-Connect (default) | No `HANDOFF_SERVER` set | Discovers or auto-starts server |
| Explicit Server | `HANDOFF_SERVER=http://...` | Connects to specified URL |
| Standalone | `HANDOFF_SERVER=none` | No server, in-memory only |

### Memory-Based Storage

Handoff data is stored **in memory only**:

- Data is shared across all connected MCP clients via the HTTP server
- Data is lost when the server process stops
- No files are written to disk - lightweight and clean
- Perfect for temporary context sharing during active sessions
- **FIFO Auto-Cleanup**: When limit is reached, oldest handoff is automatically deleted (no errors)

### Auto-Reconnection

When the shared server goes down during operation:

```
[Server stops unexpectedly]
  → User calls handoff_save()
  → Request fails (connection refused)
  → Auto-reconnection kicks in:
    → Rescan ports 1099-1200 for existing server
    → If found: connect to it
    → If not found: start new server in background
  → Retry the original request
  → User sees success (transparent recovery!)
```

- Configurable retry limit via `HANDOFF_RETRY_COUNT` (default: 30)
- On final failure: outputs pending content for manual recovery
- Other MCP clients automatically discover the new server on their next request

### Server Auto-Shutdown (TTL)

The server automatically shuts down after a period of inactivity:

- Default: 24 hours of no requests
- Configurable via `HANDOFF_SERVER_TTL` environment variable
- Set to `0` to disable auto-shutdown
- Next MCP client request will auto-start a new server

### MCP Client Configuration

**Standard configuration (recommended)** - Just works with auto-connect:

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

**Force standalone mode (no server):**

For Claude Desktop only. Claude Desktop cannot transfer conversations between projects by default, but since it shares memory space as a single app, this MCP server enables handoffs between projects. Claude Code and CLI tools run as separate processes per tab/session, so handoffs don't work in this mode.

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

### Manual Server Start (Optional)

If you prefer manual control:

```bash
# Default port (1099)
npx conversation-handoff-mcp --serve

# Custom port
npx conversation-handoff-mcp --serve --port 3000
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

**Scenario: Design discussion in Claude Desktop → Implementation in Claude Code**

1. **In Claude Desktop** - Have a design discussion:
   ```
   User: Let's design an authentication system for my app.

   Assistant: I recommend using JWT with refresh tokens...
   [detailed discussion continues]
   ```

2. **Save the conversation** - When ready to hand off:
   ```
   User: Save this conversation for implementation in Claude Code.

   Assistant: (calls handoff_save)
   ✅ Handoff saved with key: "auth-design-20241208"
   ```

3. **In Claude Code** - Load and continue:
   ```
   User: Load the auth design discussion.

   Assistant: (calls handoff_load)
   # Handoff: Authentication System Design
   [Full conversation context loaded]

   I see we discussed JWT with refresh tokens. Let me implement that...
   ```

**Key Points:**
- The AI automatically formats and saves the conversation
- Context is fully preserved including code snippets and decisions
- No manual copy-paste needed

> **Note**: The server automatically starts in the background when the first MCP client connects. No manual startup required.

## Configuration

Customize behavior via environment variables.

### Connection Settings (v0.4.0+)

| Variable | Default | Description |
|----------|---------|-------------|
| `HANDOFF_SERVER` | (auto) | `none` for standalone, or explicit server URL |
| `HANDOFF_PORT_RANGE` | `1099-1200` | Port range for auto-discovery |
| `HANDOFF_RETRY_COUNT` | 30 | Auto-reconnect retry count |
| `HANDOFF_RETRY_INTERVAL` | 10000 | Auto-reconnect interval (ms) |
| `HANDOFF_SERVER_TTL` | 86400000 (24h) | Server auto-shutdown after inactivity (0 = disabled) |

### Storage Limits

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

## Security

### Prompt Injection Protection

The `handoff_load` output includes security markers to protect against prompt injection attacks:

- **Warning banner**: Alerts AI that content is user-provided and untrusted
- **Code blocks**: User content is wrapped in code blocks to prevent interpretation as instructions
- **End marker**: Clear boundary marking end of user content

This prevents malicious content stored in handoffs from being interpreted as AI instructions.

## License

MIT

## Author

trust-delta
