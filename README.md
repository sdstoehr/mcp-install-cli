# @sdstoehr/mcp-install

Share one command, and your colleagues get an MCP server installed in **Claude Desktop** and/or **Claude Code**. Any secrets are asked for interactively.

```bash
npx @sdstoehr/mcp-install github \
  --env GITHUB_PERSONAL_ACCESS_TOKEN={{github_token}} \
  --describe github_token="GitHub PAT with repo scope" \
  -- npx -y @modelcontextprotocol/server-github
```

The CLI then:

1. asks where to install the server (Claude Desktop, Claude Code, or both), unless `--target` is given
2. prompts for every `{{placeholder}}`, using hidden input for names containing token, key, secret, password or auth
3. shows the resulting config with secrets masked and asks for confirmation
4. writes the config. For Claude Desktop, the previous file is backed up to `claude_desktop_config.json.bak`. For Claude Code, it runs `claude mcp add-json`

## Usage

```
npx @sdstoehr/mcp-install <name> [options] -- <command> [args...]   # local (stdio) server
npx @sdstoehr/mcp-install <name> [options] --url <url>              # remote server
```

| Option | Description |
|---|---|
| `-e, --env KEY=VALUE` | Environment variable for the server (repeatable) |
| `--url <url>` | Remote server URL |
| `-H, --header "Name: value"` | HTTP header for `--url` servers (repeatable) |
| `--transport http\|sse` | Remote transport (default `http`) |
| `-t, --target desktop\|code` | Where to install (repeatable or comma-separated). Asked if omitted |
| `-s, --scope user\|project\|local` | Claude Code scope (default `user`) |
| `--describe name=text` | Prompt text shown for a placeholder |
| `--set name=value` | Provide a placeholder value up front (needed for non-interactive runs) |
| `-f, --force` | Replace an existing server with the same name |
| `--dry-run` | Show what would be written, change nothing |
| `--config <path>` | Custom `claude_desktop_config.json` path |
| `-y, --yes` | Skip the final confirmation |

### Placeholders

Write `{{name}}` in the command, args, URL, `--env` or `--header` values. A placeholder that appears several times is asked for once. Values that land in `--url` are URL-encoded.

### Remote servers

```bash
npx @sdstoehr/mcp-install acme \
  --url "https://mcp.acme.com/mcp" \
  --header "Authorization: Bearer {{api_token}}"
```

- **Claude Code** connects directly (`type: http`, or `sse` with `--transport sse`).
- **Claude Desktop** only runs local servers, so the entry uses [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) as a bridge. Header values are stored as env vars (`MCP_HEADER_AUTHORIZATION`) and referenced as `${…}` in the args, so secrets never appear on the command line.

### Windows

`npx`, `npm`, `pnpm`, `yarn` and `bunx` commands are automatically wrapped as `cmd /c …`.

## Development

```bash
npm install
npm test
npm run build
node dist/cli.js --help
```

## Releasing

Publishing runs from GitHub Actions through [npm trusted publishing](https://docs.npmjs.com/trusted-publishers), so no npm token is stored in GitHub.

1. Bump the version with `npm version patch|minor|major`, then push the commit and tag with `git push --follow-tags`.
2. Create a GitHub release for the tag, e.g. `gh release create v0.2.0 --generate-notes`.
3. `.github/workflows/publish.yml` checks that the tag matches `package.json`, runs tests and the build, and publishes with provenance.
