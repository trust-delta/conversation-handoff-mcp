# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.4.x   | :white_check_mark: |
| < 0.4   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly.

### How to Report

1. **Do NOT create a public GitHub issue** for security vulnerabilities
2. Send a private report via [GitHub Security Advisories](https://github.com/trust-delta/conversation-handoff-mcp/security/advisories/new)
3. Or email the maintainer directly (if available in the repository)

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 7 days
- **Resolution target**: Within 30 days (depending on severity)

### Scope

This security policy covers:

- The conversation-handoff-mcp npm package
- The HTTP server mode (`--serve`)
- Input validation and data handling

### Out of Scope

- Vulnerabilities in dependencies (please report to the respective maintainers)
- Issues in forked or modified versions

## Security Considerations

This MCP server is designed for **local use** on trusted machines:

- Data is stored in memory only (no disk persistence)
- Default HTTP server binds to localhost only
- No authentication mechanism (by design for local use)
- For remote/multi-user deployments, additional security measures are recommended

Thank you for helping keep this project secure!
