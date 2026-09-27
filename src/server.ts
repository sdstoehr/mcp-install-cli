import type { CliOptions } from './args.js';
import { findPlaceholders, substitute } from './placeholders.js';

/** Stdio servers carry command/args/env; remote servers (Claude Code only) carry type/url/headers. */
export interface ServerEntry {
  type?: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

type Values = Record<string, string>;

// Package runners are .cmd shims on Windows and can't be spawned directly.
const WINDOWS_SHIMS = new Set(['npx', 'npm', 'pnpm', 'pnpx', 'yarn', 'bunx']);

export function placeholdersOf(options: CliOptions): string[] {
  return findPlaceholders(
    options.command ?? '',
    ...options.commandArgs,
    options.url ?? '',
    ...Object.values(options.env),
    ...Object.values(options.headers),
  );
}

/**
 * Claude Desktop only launches stdio servers, so remote servers are bridged through mcp-remote.
 * Header values go into env vars and are referenced as ${VAR}, keeping secrets out of the args list.
 */
export function buildDesktopEntry(options: CliOptions, values: Values, platform = process.platform): ServerEntry {
  const env = resolveRecord(options.env, values);

  if (options.url) {
    const args = ['-y', 'mcp-remote', resolveUrl(options.url, values)];
    if (options.transport === 'sse') args.push('--transport', 'sse-only');
    for (const [header, value] of Object.entries(options.headers)) {
      const envName = headerEnvName(header);
      env[envName] = substitute(value, values);
      args.push('--header', `${header}:\${${envName}}`);
    }
    return withEnv(wrapForWindows('npx', args, platform), env);
  }

  const command = substitute(options.command!, values);
  const args = options.commandArgs.map((arg) => substitute(arg, values));
  return withEnv(wrapForWindows(command, args, platform), env);
}

export function buildCodeEntry(options: CliOptions, values: Values, platform = process.platform): ServerEntry {
  if (options.url) {
    const entry: ServerEntry = { type: options.transport, url: resolveUrl(options.url, values) };
    const headers = resolveRecord(options.headers, values);
    if (Object.keys(headers).length) entry.headers = headers;
    return entry;
  }

  const command = substitute(options.command!, values);
  const args = options.commandArgs.map((arg) => substitute(arg, values));
  return { type: 'stdio', ...withEnv(wrapForWindows(command, args, platform), resolveRecord(options.env, values)) };
}

export function headerEnvName(header: string): string {
  return `MCP_HEADER_${header.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

function resolveUrl(url: string, values: Values): string {
  return substitute(url, values, encodeURIComponent);
}

function resolveRecord(record: Record<string, string>, values: Values): Record<string, string> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, substitute(value, values)]));
}

function wrapForWindows(command: string, args: string[], platform: NodeJS.Platform) {
  if (platform === 'win32' && WINDOWS_SHIMS.has(command.toLowerCase())) {
    return { command: 'cmd', args: ['/c', command, ...args] };
  }
  return { command, args };
}

function withEnv(entry: { command: string; args: string[] }, env: Record<string, string>): ServerEntry {
  return Object.keys(env).length ? { ...entry, env } : entry;
}
