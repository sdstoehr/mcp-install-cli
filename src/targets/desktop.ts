import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ServerEntry } from '../server.js';

export function defaultDesktopConfigPath(platform = process.platform, env = process.env): string {
  const file = 'claude_desktop_config.json';
  switch (platform) {
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', 'Claude', file);
    case 'win32':
      return join(env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Claude', file);
    default:
      return join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'Claude', file);
  }
}

interface DesktopConfig {
  mcpServers?: Record<string, ServerEntry>;
  [key: string]: unknown;
}

export async function readDesktopConfig(path: string): Promise<DesktopConfig> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  if (!raw.trim()) return {};
  try {
    const config = JSON.parse(raw);
    if (typeof config !== 'object' || config === null || Array.isArray(config)) throw new Error('not an object');
    return config;
  } catch (err) {
    throw new Error(`Could not parse ${path}: ${(err as Error).message}. Fix or remove the file and try again.`);
  }
}

export function hasDesktopServer(config: DesktopConfig, name: string): boolean {
  return Boolean(config.mcpServers && name in config.mcpServers);
}

/** Merges the entry into the config, backing up the previous file to `<path>.bak`. Returns the backup path, if any. */
export async function writeDesktopServer(
  path: string,
  config: DesktopConfig,
  name: string,
  entry: ServerEntry,
): Promise<string | undefined> {
  const next: DesktopConfig = { ...config, mcpServers: { ...config.mcpServers, [name]: entry } };

  await mkdir(dirname(path), { recursive: true });
  let backup: string | undefined;
  try {
    await copyFile(path, `${path}.bak`);
    backup = `${path}.bak`;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  // Write to a temp file and rename, so a crash never leaves a half-written config behind.
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, path);
  return backup;
}
