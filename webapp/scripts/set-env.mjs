#!/usr/bin/env node
/**
 * Points the app at the API the rest of the stack was brought up with, so a
 * developer edits one file (`../.env`) rather than two.
 *
 * It writes `.env.local`, which Vite reads. An explicit `VITE_API_URL` in the
 * environment still wins over the file, which is how the image build - where
 * there is no `../.env` at all - passes `API_URL_EXTERNAL` in.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(here, '..', '..', '.env');
const target = resolve(here, '..', '.env.local');

if (!existsSync(rootEnv)) {
  console.log('[set-env] no ../.env - leaving VITE_API_URL to the environment');
  process.exit(0);
}

const read = key => {
  for (const line of readFileSync(rootEnv, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1 || trimmed.slice(0, eq).trim() !== key) continue;
    return trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return null;
};

const apiUrl = read('API_URL_EXTERNAL') ?? 'http://localhost:5081';
writeFileSync(target, `# Written by scripts/set-env.mjs from ../.env. Do not edit.\nVITE_API_URL=${apiUrl}\n`);
console.log(`[set-env] VITE_API_URL=${apiUrl}`);
