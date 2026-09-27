import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCliArgs, UsageError, type CliOptions } from '../src/args.js';
import { findPlaceholders, isSecretName, maskSecrets, substitute } from '../src/placeholders.js';
import { buildCodeEntry, buildDesktopEntry, placeholdersOf } from '../src/server.js';
import { readDesktopConfig, writeDesktopServer } from '../src/targets/desktop.js';

function parse(argv: string[]): CliOptions {
  const result = parseCliArgs(argv);
  if (result.kind !== 'run') throw new Error(`unexpected ${result.kind}`);
  return result.options;
}

describe('placeholders', () => {
  it('finds unique names in order, tolerating inner whitespace', () => {
    expect(findPlaceholders('a {{token}} b {{ org }}', '{{token}}')).toEqual(['token', 'org']);
  });

  it('ignores angle-bracket syntax', () => {
    expect(findPlaceholders('<token>')).toEqual([]);
  });

  it('substitutes with an optional encoder', () => {
    expect(substitute('x={{v}}', { v: 'a b&c' }, encodeURIComponent)).toBe('x=a%20b%26c');
    expect(() => substitute('{{missing}}', {})).toThrow(/missing/);
  });

  it('detects secret-like names', () => {
    expect(isSecretName('github_token')).toBe(true);
    expect(isSecretName('API_KEY')).toBe(true);
    expect(isSecretName('org')).toBe(false);
  });

  it('masks plain, URL-encoded and JSON-escaped secrets', () => {
    expect(maskSecrets('k=a%2Fb and "a/b"', ['a/b'])).toBe('k=•••••• and "••••••"');
  });
});

describe('parseCliArgs', () => {
  it('splits the server command after --', () => {
    const o = parse(['gh', '-e', 'TOKEN={{t}}', '-t', 'desktop,code', '--', 'npx', '-y', 'pkg', '--flag']);
    expect(o).toMatchObject({
      name: 'gh',
      command: 'npx',
      commandArgs: ['-y', 'pkg', '--flag'],
      env: { TOKEN: '{{t}}' },
      targets: ['desktop', 'code'],
      scope: 'user',
    });
  });

  it('parses headers on the first colon', () => {
    const o = parse(['x', '--url', 'https://a/b', '-H', 'Authorization: Bearer {{t}}']);
    expect(o.headers).toEqual({ Authorization: 'Bearer {{t}}' });
  });

  it.each([
    [[], /Missing server name/],
    [['a', 'b'], /exactly one/],
    [['a'], /Missing server/],
    [['a', '--url', 'u', '--', 'cmd'], /either/],
    [['a', '-H', 'X: y', '--', 'cmd'], /only applies/],
    [['a', '-t', 'cursor', '--', 'cmd'], /Invalid target/],
    [['a b', '--', 'cmd'], /Invalid server name/],
    [['a', '-e', 'novalue', '--', 'cmd'], /Invalid --env/],
  ])('rejects %j', (argv, message) => {
    expect(() => parseCliArgs(argv as string[])).toThrow(UsageError);
    expect(() => parseCliArgs(argv as string[])).toThrow(message);
  });
});

describe('server entries', () => {
  const stdio = parse(['gh', '-e', 'TOKEN={{token}}', '--', 'npx', '-y', 'server', '--org={{org}}']);
  const remote = parse(['acme', '--url', 'https://x.dev/mcp?k={{key}}', '-H', 'Authorization: Bearer {{token}}']);
  const values = { token: 'secret', org: 'my org', key: 'a&b' };

  it('collects placeholders from every field', () => {
    expect(placeholdersOf(stdio)).toEqual(['org', 'token']);
    expect(placeholdersOf(remote)).toEqual(['key', 'token']);
  });

  it('builds a stdio entry for Claude Desktop', () => {
    expect(buildDesktopEntry(stdio, values, 'darwin')).toEqual({
      command: 'npx',
      args: ['-y', 'server', '--org=my org'],
      env: { TOKEN: 'secret' },
    });
  });

  it('wraps npx with cmd /c on Windows', () => {
    expect(buildDesktopEntry(stdio, values, 'win32')).toMatchObject({
      command: 'cmd',
      args: ['/c', 'npx', '-y', 'server', '--org=my org'],
    });
  });

  it('bridges remote servers through mcp-remote with headers in env', () => {
    expect(buildDesktopEntry(remote, values, 'darwin')).toEqual({
      command: 'npx',
      args: ['-y', 'mcp-remote', 'https://x.dev/mcp?k=a%26b', '--header', 'Authorization:${MCP_HEADER_AUTHORIZATION}'],
      env: { MCP_HEADER_AUTHORIZATION: 'Bearer secret' },
    });
  });

  it('uses sse-only transport for sse servers in Claude Desktop', () => {
    const sse = parse(['s', '--url', 'https://x.dev/sse', '--transport', 'sse']);
    expect(buildDesktopEntry(sse, {}, 'darwin').args).toEqual(['-y', 'mcp-remote', 'https://x.dev/sse', '--transport', 'sse-only']);
  });

  it('connects Claude Code to remote servers directly', () => {
    expect(buildCodeEntry(remote, values, 'darwin')).toEqual({
      type: 'http',
      url: 'https://x.dev/mcp?k=a%26b',
      headers: { Authorization: 'Bearer secret' },
    });
  });

  it('builds a stdio entry for Claude Code', () => {
    expect(buildCodeEntry(stdio, values, 'darwin')).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'server', '--org=my org'],
      env: { TOKEN: 'secret' },
    });
  });
});

describe('Claude Desktop config', () => {
  it('merges servers, keeps other keys and writes a backup', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcp-install-'));
    const path = join(dir, 'claude_desktop_config.json');
    const original = { theme: 'dark', mcpServers: { other: { command: 'x' } } };
    await writeFile(path, JSON.stringify(original));

    const backup = await writeDesktopServer(path, await readDesktopConfig(path), 'new', { command: 'y' });

    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      theme: 'dark',
      mcpServers: { other: { command: 'x' }, new: { command: 'y' } },
    });
    expect(JSON.parse(await readFile(backup!, 'utf8'))).toEqual(original);
  });

  it('creates the config when it does not exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcp-install-'));
    const path = join(dir, 'nested', 'claude_desktop_config.json');
    const backup = await writeDesktopServer(path, await readDesktopConfig(path), 'a', { command: 'b' });
    expect(backup).toBeUndefined();
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ mcpServers: { a: { command: 'b' } } });
  });

  it('refuses to overwrite an unparseable config', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcp-install-'));
    const path = join(dir, 'claude_desktop_config.json');
    await writeFile(path, '{ broken');
    await expect(readDesktopConfig(path)).rejects.toThrow(/Could not parse/);
  });
});
