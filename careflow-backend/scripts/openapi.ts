import { mkdirSync, writeFileSync } from 'node:fs';
import { createApp } from '../src/app.js';
const { app, doc } = await createApp({ startWorker: false });
try {
  mkdirSync('docs', { recursive: true });
  writeFileSync('docs/openapi.json', JSON.stringify(doc, null, 2) + '\n');
  console.log('Exported docs/openapi.json');
} finally {
  await app.close();
}
