import { build } from 'esbuild';
import { resolve } from 'node:path';
// Only the official model/serialization subset is bundled. No browser, credential or crypto flow runs here.
await build({
  absWorkingDir: process.cwd(),
  entryPoints: [resolve('node_modules/@tideorg/js/dist/Models/Policy.js')],
  tsconfig: resolve('tsconfig.json'),
  outfile: 'dist/src/vendor/tide-policy.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  legalComments: 'eof',
});
