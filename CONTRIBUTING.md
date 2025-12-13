# Contributing to conversation-handoff-mcp

Thank you for your interest in contributing!

## Development Setup

```bash
git clone https://github.com/trust-delta/conversation-handoff-mcp.git
cd conversation-handoff-mcp
npm install
npm run build
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript |
| `npm run dev` | Watch mode compilation |
| `npm run test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run check` | Run linter and formatter check |
| `npm run check:fix` | Auto-fix lint and format issues |
| `npm run typecheck` | TypeScript type checking |

## Pull Request Process

1. Fork the repository
2. Create a feature branch from `develop`
3. Make your changes
4. Ensure all checks pass:

   ```bash
   npm run check
   npm run typecheck
   npm run test
   npm run build
   ```

5. Submit a PR to the `develop` branch

## Code Style

- This project uses [Biome](https://biomejs.dev/) for linting and formatting
- Pre-commit hooks automatically run checks via husky
- TypeScript strict mode is enabled

## Commit Messages

- Use clear, descriptive commit messages
- Reference issues when applicable (e.g., `fix: resolve #123`)

## Testing

- Add tests for new features
- Ensure existing tests pass
- Tests are written with [Vitest](https://vitest.dev/)

## Questions?

Feel free to open an issue for discussion before starting major changes.
