import { spawn } from 'node:child_process';
import { context } from './api';
import { entryPoint, SERVER_ROOT } from './infra/app';

/** `npm run migrate` against a database of the spec's own, and everything it printed. */
export const runMigrationCli = (database: string, ...args: string[]): Promise<{ code: number | null; output: string }> => {
  const entry = entryPoint('dist/migrations/cli.js', 'src/migrations/cli.ts');
  const child = spawn('node', [...entry.nodeArgs, entry.script, ...args], {
    cwd: SERVER_ROOT,
    env: { ...process.env, ...context.appEnv, DB_DATABASE: database },
  });

  let output = '';
  child.stdout.on('data', chunk => (output += String(chunk)));
  child.stderr.on('data', chunk => (output += String(chunk)));

  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => resolve({ code, output }));
  });
};
