#!/usr/bin/env node
/**
 * Points the app at the API the rest of the stack was brought up with, so a
 * developer edits one file (`../.env`) rather than two.
 *
 * It writes `.env.local`, which Vite reads. An explicit `VITE_API_URL` in the
 * environment still wins over the file, which is how the image build - where
 * there is no `../.env` at all - passes `API_URL_EXTERNAL` in.
 *
 * A `.env.local` that does not start with the line this script writes is one a
 * developer wrote to point the app at another API, and it is left alone:
 * rewriting it on every start would undo it.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(here, '..', '..', '.env');
const target = resolve(here, '..', '.env.local');
const GENERATED = '# Written by scripts/set-env.mjs from ../.env';

const valueOf = (text, key) => {
  for (const line of text.split(/\r?\n/)) {
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

if (existsSync(target)) {
  const own = readFileSync(target, 'utf8');
  if (!own.startsWith(GENERATED)) {
    console.log(`[set-env] keeping webapp/.env.local, written by hand: VITE_API_URL=${valueOf(own, 'VITE_API_URL') ?? '(unset)'}`);
    process.exit(0);
  }
}

if (!existsSync(rootEnv)) {
  console.log('[set-env] no ../.env - leaving VITE_API_URL to the environment');
  process.exit(0);
}

const apiUrl = valueOf(readFileSync(rootEnv, 'utf8'), 'API_URL_EXTERNAL') ?? 'http://localhost:5081';
writeFileSync(target, `${GENERATED} on every start. Delete this line and the file is yours: set-env leaves it alone.\nVITE_API_URL=${apiUrl}\n`);
console.log(`[set-env] VITE_API_URL=${apiUrl}`);
