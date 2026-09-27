import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  // Bundle the prompt library so `npx` only has to fetch a single package.
  noExternal: ['@clack/prompts'],
  banner: { js: '#!/usr/bin/env node' },
});
