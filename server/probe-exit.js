const { spawn } = require('node:child_process');
const env = { ...process.env, ...require('./test/.tmp/context.json').appEnv, PORT: '0' };
const script = "require('./src/main.ts'); setTimeout(() => { throw new Error('MARKER a throw nothing is going to catch'); }, 3000);";
const child = spawn('node', ['-r', 'ts-node/register/transpile-only', '-r', 'tsconfig-paths/register', '-e', script], { env });
let out = '';
child.stdout.on('data', c => (out += c));
child.stderr.on('data', c => (out += c));
const t = setTimeout(() => { console.log('STILL RUNNING after 15s'); child.kill('SIGKILL'); }, 15000);
child.on('exit', code => {
  clearTimeout(t);
  console.log('EXIT CODE:', code);
  console.log('saw marker on stderr-first line:', /^MARKER|Uncaught exception.*MARKER/m.test(out));
  console.log(out.split('\n').filter(l => /MARKER|Uncaught|exit/i.test(l)).slice(0, 6).join('\n'));
});
