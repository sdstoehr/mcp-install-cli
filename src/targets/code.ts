import { spawnSync } from 'node:child_process';
import type { Scope } from '../args.js';
import type { ServerEntry } from '../server.js';

export interface ClaudeResult {
  ok: boolean;
  output: string;
}

function runClaude(args: string[]): ClaudeResult {
  const result = spawnSync('claude', args, { encoding: 'utf8' });
  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('The "claude" CLI was not found on your PATH. Install Claude Code first: https://claude.com/claude-code');
    }
    throw result.error;
  }
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

export function codeAddArgs(name: string, entry: ServerEntry, scope: Scope): string[] {
  return ['mcp', 'add-json', name, JSON.stringify(entry), '--scope', scope];
}

export function addCodeServer(name: string, entry: ServerEntry, scope: Scope): ClaudeResult {
  return runClaude(codeAddArgs(name, entry, scope));
}

export function removeCodeServer(name: string, scope: Scope): ClaudeResult {
  return runClaude(['mcp', 'remove', name, '--scope', scope]);
}

export function isAlreadyExistsError(output: string): boolean {
  return /already exists/i.test(output);
}
