import { spawn } from 'node:child_process';
const compiler = spawn(
  process.execPath,
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--watch', '--preserveWatchOutput'],
  { stdio: 'inherit' },
);
const server = spawn(process.execPath, ['--watch', 'dist/src/main.js'], { stdio: 'inherit' });
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  compiler.kill();
  server.kill();
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
compiler.on('error', () => stop(1));
server.on('error', () => stop(1));
compiler.on('exit', (code) => stop(code ?? 1));
server.on('exit', (code) => stop(code ?? 1));
