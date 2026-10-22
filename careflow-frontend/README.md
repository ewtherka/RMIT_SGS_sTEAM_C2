# CareFlow frontend

React + TypeScript + Vite. Vietnamese patient, clinician and independent-admin workspaces. Requires Node 24+ and the sibling `careflow-backend/` checkout.

## Start the simulated app

1. Start the backend as described in [SIMULATED_TIDE.md](../careflow-backend/docs/SIMULATED_TIDE.md): seed it, set `TIDE_MODE=simulated` and a private `QR_SIGNING_KEY`, then start the API on port 3333.
2. In this folder run `npm ci`, then `npm run dev`. Open the address printed by Vite (port 5173). Both services must run on the same machine for localhost to work.
3. The default front-end mode is `simulation`. Optional `.env` values are in `.env.example`: `VITE_API_BASE_URL=http://localhost:3333`, `VITE_AUTH_MODE=simulation`.
4. Click **Đăng nhập** / **Chọn tài khoản**. Identities and roles come from the server; simulated JWTs remain in memory and are verified by the API. Reload intentionally signs out. No token, role, personal record or plaintext is stored in localStorage.

## Demo

Patient → book BS. Lan → Lan opens a record and is denied → patient submits a sharing request → admin 1 approves, still denied → admin 2 approves → Lan can open that record. A second record remains closed. Repeat with REVOKE to demonstrate withdrawal after two independent approvals.

Use **Đổi tài khoản** in the visible simulation banner for the separate demo identities. Each admin can approve once. Admins do not gain record-reading rights from their role. All changes are made by backend endpoints; the UI never grants permissions by itself.

Also implemented: service/doctor search, current availability, booking confirmation, reschedule, cancellation, attendance confirmation, visit history, clinician-requested follow-ups, profile editing and simulated notifications. Booking mutations preserve their idempotency key on retry and use the server's `version`.

## Checks

```sh
npm test
npm run build
# With the API and Vite running:
npm run test:browser
```

Browser tests use Playwright. Run `npx playwright install chromium` once, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an existing Chromium executable.

## Real Tide mode

Set `VITE_AUTH_MODE=tide` and run the backend in strict mode with a valid adapter. The pinned official SDK uses one provider with strict ES256 DPoP and signs absolute API URLs via `IAMService.secureFetch`. An unconfigured backend displays a setup error; it never falls back to simulated sign-in or Bearer authentication. Real login, crypto and admin quorum still require live Tide verification.

The Vite development/preview host serves `/tide_dpop/*` with the official byte-exact backend relay and its dedicated CSP headers. A static production host must rewrite that path to `tide_dpop_auth.html`, set `Allow-CSP-From: *` and `Content-Security-Policy: default-src 'self'; script-src 'unsafe-inline'` **on the relay only**, and omit X-Frame-Options/frame-ancestors there. Support SPA reloads at `/auth/redirect`.

## Honest boundaries

Simulation is explicitly requested for the competition prototype. The backend holds the AES key and simulates threshold decisions in SQLite; this is **not live Tide E2EE or cryptographic Emergent Authority**. The banner, authentication chooser and admin workflow disclose this.

Tide placement is based on D's Raziel MCP feature-mapping handoff in [the backend plan](../careflow-backend/docs/SIMULATED_TIDE.md). A's cloud cannot directly reach the MCP endpoint (`CONNECT 403`); this is not claimed as a successful MCP call by A. No real credentials belong in VITE variables or the repository.
