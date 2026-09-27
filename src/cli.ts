import * as p from '@clack/prompts';
import { createRequire } from 'node:module';
import { parseCliArgs, UsageError, type CliOptions, type Target } from './args.js';
import { isSecretName, maskSecrets } from './placeholders.js';
import { buildCodeEntry, buildDesktopEntry, placeholdersOf, type ServerEntry } from './server.js';
import { addCodeServer, codeAddArgs, isAlreadyExistsError, removeCodeServer } from './targets/code.js';
import {
  defaultDesktopConfigPath,
  hasDesktopServer,
  readDesktopConfig,
  writeDesktopServer,
} from './targets/desktop.js';

const HELP = `
Install an MCP server into Claude Desktop and/or Claude Code.

Usage:
  npx @sdstoehr/mcp-install <name> [options] -- <command> [args...]
  npx @sdstoehr/mcp-install <name> [options] --url <url>

Placeholders:
  Write {{name}} anywhere in the command, args, URL, --env or --header values.
  Each placeholder is asked for once. Names containing token/key/secret/password/auth
  are read as hidden input. Values inside --url are URL-encoded.

Options:
  -e, --env KEY=VALUE        Environment variable for the server (repeatable)
      --url <url>            Remote server URL (Claude Desktop uses mcp-remote as a bridge)
  -H, --header "Name: value" HTTP header for --url servers (repeatable)
      --transport http|sse   Remote transport (default: http)
  -t, --target desktop|code  Where to install (repeatable, or comma-separated). Asked if omitted
  -s, --scope user|project|local
                             Claude Code scope (default: user)
      --describe name=text   Prompt text for a placeholder (repeatable)
      --set name=value       Provide a placeholder value up front (repeatable)
  -f, --force                Overwrite an existing server with the same name
      --dry-run              Show what would be written, change nothing
      --config <path>        Path to claude_desktop_config.json
  -y, --yes                  Skip the final confirmation
  -h, --help                 Show this help
  -v, --version              Show the version

Examples:
  npx @sdstoehr/mcp-install github \\
    --env GITHUB_PERSONAL_ACCESS_TOKEN={{github_token}} \\
    --describe github_token="GitHub PAT with repo scope" \\
    -- npx -y @modelcontextprotocol/server-github

  npx @sdstoehr/mcp-install acme --url "https://mcp.acme.com/mcp" \\
    --header "Authorization: Bearer {{api_token}}"
`;

const TARGET_LABELS: Record<Target, string> = { desktop: 'Claude Desktop', code: 'Claude Code' };

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`Error: ${err.message}\nRun with --help for usage.`);
      process.exit(2);
    }
    throw err;
  }
  if (parsed.kind === 'help') return void console.log(HELP.trimStart());
  if (parsed.kind === 'version') {
    return void console.log(createRequire(import.meta.url)('../package.json').version);
  }

  const options = parsed.options;
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  p.intro(`Install MCP server "${options.name}"`);

  const targets = await resolveTargets(options, interactive);
  const values = await resolvePlaceholders(options, interactive);
  const secrets = Object.entries(values)
    .filter(([name]) => isSecretName(name))
    .map(([, value]) => value);
  const mask = (text: string) => maskSecrets(text, secrets);

  const desktopPath = options.configPath ?? defaultDesktopConfigPath();
  const desktopEntry = targets.includes('desktop') ? buildDesktopEntry(options, values) : undefined;
  const codeEntry = targets.includes('code') ? buildCodeEntry(options, values) : undefined;

  if (desktopEntry) {
    p.note(mask(JSON.stringify({ [options.name]: desktopEntry }, null, 2)), `Claude Desktop → ${desktopPath}`);
  }
  if (codeEntry) {
    p.note(mask(JSON.stringify({ [options.name]: codeEntry }, null, 2)), `Claude Code → ${options.scope} scope`);
    if (options.url && Object.keys(options.env).length) {
      p.log.warn('Claude Code connects to remote servers directly, so --env is ignored there.');
    }
    if (options.scope === 'project' && secrets.length) {
      p.log.warn('Project scope writes .mcp.json into this directory. Do not commit it, it contains your secrets.');
    }
  }

  if (options.dryRun) {
    if (codeEntry) p.log.info(`Would run: claude ${mask(shellQuote(codeAddArgs(options.name, codeEntry, options.scope)))}`);
    p.outro('Dry run, nothing was changed.');
    return;
  }

  const desktopConfig = desktopEntry ? await readDesktopConfig(desktopPath) : undefined;
  if (desktopConfig && hasDesktopServer(desktopConfig, options.name) && !options.force) {
    await confirmOverwrite(`Claude Desktop already has a server named "${options.name}". Replace it?`, interactive);
  }

  if (interactive && !options.yes) {
    const proceed = guard(await p.confirm({ message: `Install into ${targets.map((t) => TARGET_LABELS[t]).join(' and ')}?` }));
    if (!proceed) return cancel();
  }

  if (desktopEntry && desktopConfig) {
    const backup = await writeDesktopServer(desktopPath, desktopConfig, options.name, desktopEntry);
    p.log.success(`Added to Claude Desktop${backup ? ` (previous config saved to ${backup})` : ''}.`);
  }
  if (codeEntry) {
    await installCode(options, codeEntry, interactive);
    p.log.success(`Added to Claude Code (${options.scope} scope).`);
  }

  const nextSteps = [];
  if (desktopEntry) nextSteps.push('Quit and reopen Claude Desktop to load the server.');
  if (codeEntry) nextSteps.push('Run /mcp in Claude Code to check the connection.');
  p.outro(nextSteps.join('\n   '));
}

async function resolveTargets(options: CliOptions, interactive: boolean): Promise<Target[]> {
  if (options.targets.length) return options.targets;
  if (!interactive) fail('No target given. Pass --target desktop, --target code, or both.');
  return guard(
    await p.multiselect<Target>({
      message: 'Where should the server be installed?',
      options: [
        { value: 'desktop', label: TARGET_LABELS.desktop },
        { value: 'code', label: TARGET_LABELS.code, hint: `${options.scope} scope` },
      ],
      required: true,
    }),
  );
}

async function resolvePlaceholders(options: CliOptions, interactive: boolean): Promise<Record<string, string>> {
  const names = placeholdersOf(options);
  for (const name of Object.keys(options.presets)) {
    if (!names.includes(name)) p.log.warn(`--set ${name} does not match any {{placeholder}}.`);
  }
  for (const name of Object.keys(options.descriptions)) {
    if (!names.includes(name)) p.log.warn(`--describe ${name} does not match any {{placeholder}}.`);
  }

  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of names) {
    if (name in options.presets) values[name] = options.presets[name]!;
    else missing.push(name);
  }
  if (missing.length && !interactive) {
    fail(`Missing values for ${missing.map((n) => `{{${n}}}`).join(', ')}. Pass them with --set name=value.`);
  }

  for (const name of missing) {
    const message = options.descriptions[name] ?? name;
    const validate = (value: string | undefined) => (value?.trim() ? undefined : 'A value is required.');
    const value = isSecretName(name)
      ? await p.password({ message, validate })
      : await p.text({ message, validate });
    values[name] = guard(value).trim();
  }
  return values;
}

async function installCode(options: CliOptions, entry: ServerEntry, interactive: boolean): Promise<void> {
  let result = addCodeServer(options.name, entry, options.scope);
  if (!result.ok && isAlreadyExistsError(result.output)) {
    if (!options.force) {
      await confirmOverwrite(`Claude Code already has a server named "${options.name}". Replace it?`, interactive);
    }
    removeCodeServer(options.name, options.scope);
    result = addCodeServer(options.name, entry, options.scope);
  }
  if (!result.ok) fail(`claude mcp add-json failed:\n${result.output}`);
}

async function confirmOverwrite(message: string, interactive: boolean): Promise<void> {
  if (!interactive) fail(`${message.replace(/ Replace it\?$/, '')} Use --force to replace it.`);
  if (!guard(await p.confirm({ message, initialValue: false }))) cancel();
}

function shellQuote(args: string[]): string {
  return args.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' ');
}

function guard<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) cancel();
  return value as Exclude<T, symbol>;
}

function cancel(): never {
  p.cancel('Installation cancelled.');
  process.exit(1);
}

function fail(message: string): never {
  p.log.error(message);
  process.exit(1);
}

main().catch((err: Error) => {
  p.log.error(err.message);
  process.exit(1);
});
