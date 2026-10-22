import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { serveFrontend } from './demo-server.mjs';

test('packaged demo host serves the build and preserves the official Tide relay', async t => {
  const root = fileURLToPath(new URL('../careflow-frontend/dist/', import.meta.url));
  const server = await serveFrontend(root, 0);
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const html = await (await fetch(origin)).text();
    await t.test('serves CareFlow production HTML and hashed assets', async () => {
      assert.match(html, /CareFlow/);
      const asset = html.match(/src="([^"]+\.js)"/)[1];
      const response = await fetch(origin + asset);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /javascript/);
    });
    await t.test('SPA redirect reload works without a Vite server', async () => {
      assert.equal(await (await fetch(origin + '/auth/redirect')).text(), html);
    });
    await t.test('official relay is byte-exact with dedicated CSP and no frame restriction', async () => {
      const relay = await fetch(origin + '/tide_dpop/packaged-demo');
      assert.equal(relay.status, 200);
      assert.equal(relay.headers.get('allow-csp-from'), '*');
      assert.equal(relay.headers.get('content-security-policy'), "default-src 'self'; script-src 'unsafe-inline'");
      assert.equal(relay.headers.get('x-frame-options'), null);
      assert.deepEqual(Buffer.from(await relay.arrayBuffer()), await readFile(new URL('../careflow-backend/public/tide_dpop_auth.html', import.meta.url)));
      assert.equal((await fetch(origin)).headers.get('content-security-policy'), null);
    });
    await t.test('missing assets return 404 and mutations are refused', async () => {
      assert.equal((await fetch(origin + '/not-found.js')).status, 404);
      assert.equal((await fetch(origin, { method: 'POST' })).status, 405);
    });
    await t.test('does not silently replace another listener', async () => {
      await assert.rejects(serveFrontend(root, server.address().port), { code: 'EADDRINUSE' });
    });
  } finally { await new Promise(done => server.close(done)); }
});
