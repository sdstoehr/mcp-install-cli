import { parseArgs } from 'node:util';

export type Target = 'desktop' | 'code';
export type Scope = 'user' | 'project' | 'local';
export type Transport = 'http' | 'sse';

export interface CliOptions {
  name: string;
  command?: string;
  commandArgs: string[];
  url?: string;
  transport: Transport;
  env: Record<string, string>;
  headers: Record<string, string>;
  descriptions: Record<string, string>;
  presets: Record<string, string>;
  targets: Target[];
  scope: Scope;
  force: boolean;
  dryRun: boolean;
  yes: boolean;
  configPath?: string;
}

export type ParseResult =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'run'; options: CliOptions };

export class UsageError extends Error {}

const TARGET_ALIASES: Record<string, Target> = {
  desktop: 'desktop',
  'claude-desktop': 'desktop',
  code: 'code',
  'claude-code': 'code',
};

const SERVER_NAME = /^[A-Za-z0-9_-]+$/;

export function parseCliArgs(argv: string[]): ParseResult {
  // Everything after the first `--` is the server command, untouched by option parsing.
  const sep = argv.indexOf('--');
  const own = sep === -1 ? argv : argv.slice(0, sep);
  const [command, ...commandArgs] = sep === -1 ? [] : argv.slice(sep + 1);

  let parsed;
  try {
    parsed = parseArgs({
      args: own,
      allowPositionals: true,
      strict: true,
      options: {
        env: { type: 'string', short: 'e', multiple: true },
        url: { type: 'string' },
        header: { type: 'string', short: 'H', multiple: true },
        transport: { type: 'string' },
        describe: { type: 'string', multiple: true },
        set: { type: 'string', multiple: true },
        target: { type: 'string', short: 't', multiple: true },
        scope: { type: 'string', short: 's' },
        force: { type: 'boolean', short: 'f' },
        'dry-run': { type: 'boolean' },
        config: { type: 'string' },
        yes: { type: 'boolean', short: 'y' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
  const { values, positionals } = parsed;

  if (values.help) return { kind: 'help' };
  if (values.version) return { kind: 'version' };

  if (positionals.length !== 1) {
    throw new UsageError(
      positionals.length === 0
        ? 'Missing server name.'
        : `Expected exactly one server name, got: ${positionals.join(' ')}. Did you forget "--" before the server command?`,
    );
  }
  const name = positionals[0]!;
  if (!SERVER_NAME.test(name)) {
    throw new UsageError(`Invalid server name "${name}". Use letters, digits, "-" and "_" only.`);
  }

  if (command && values.url) throw new UsageError('Use either "--url" or "-- <command>", not both.');
  if (!command && !values.url) throw new UsageError('Missing server: pass "--url <url>" or "-- <command> [args...]".');
  if (values.header?.length && !values.url) throw new UsageError('"--header" only applies to "--url" servers.');
  if (values.transport && !values.url) throw new UsageError('"--transport" only applies to "--url" servers.');

  const transport = (values.transport ?? 'http') as Transport;
  if (transport !== 'http' && transport !== 'sse') {
    throw new UsageError(`Invalid transport "${values.transport}". Use "http" or "sse".`);
  }

  const scope = (values.scope ?? 'user') as Scope;
  if (!['user', 'project', 'local'].includes(scope)) {
    throw new UsageError(`Invalid scope "${values.scope}". Use "user", "project" or "local".`);
  }

  const targets = new Set<Target>();
  for (const raw of (values.target ?? []).flatMap((t) => t.split(','))) {
    const target = TARGET_ALIASES[raw.trim().toLowerCase()];
    if (!target) throw new UsageError(`Invalid target "${raw}". Use "desktop" or "code".`);
    targets.add(target);
  }

  return {
    kind: 'run',
    options: {
      name,
      command,
      commandArgs,
      url: values.url,
      transport,
      env: parsePairs(values.env, '=', '--env', 'KEY=VALUE'),
      headers: parsePairs(values.header, ':', '--header', '"Name: value"'),
      descriptions: parsePairs(values.describe, '=', '--describe', 'name="text"'),
      presets: parsePairs(values.set, '=', '--set', 'name=value'),
      targets: [...targets],
      scope,
      force: values.force ?? false,
      dryRun: values['dry-run'] ?? false,
      yes: values.yes ?? false,
      configPath: values.config,
    },
  };
}

function parsePairs(
  items: string[] | undefined,
  separator: string,
  flag: string,
  format: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of items ?? []) {
    const index = item.indexOf(separator);
    const key = index === -1 ? '' : item.slice(0, index).trim();
    if (!key) throw new UsageError(`Invalid ${flag} "${item}". Expected ${format}.`);
    result[key] = item.slice(index + 1).trim();
  }
  return result;
}
