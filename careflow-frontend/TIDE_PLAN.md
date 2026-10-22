# TideCloak placement and prototype boundaries

The user requested an app designed as if TideCloak protects it, with simulated sign-in, roles and access checks for this prototype. This plan follows agent D's **Tide Raziel MCP `feature-mapping`** handoff, recorded in [SIMULATED_TIDE.md](../careflow-backend/docs/SIMULATED_TIDE.md). The frontend agent could not directly reach the MCP service from its cloud network (`CONNECT 403`); no direct successful MCP call is claimed here.

| Boundary | Current runnable prototype | Real Tide replacement |
| --- | --- | --- |
| Identity | The account chooser requests a signed simulated JWT from `/v1/sim/session`, then loads `/v1/me`. | Official React provider and Tide's sign-in. |
| Session | Token stays in React memory; reload signs out. A 401 clears the session. | SDK session lifecycle and refresh, with strict ES256 DPoP. |
| API authorization | Server verifies the simulated token and roles. UI route guards only guide navigation. | Backend verifies Tide JWT and sender-bound DPoP on every private request. |
| Record access | `/v1/sim/records/:id/decrypt` checks ownership, authorship or a quorum-approved grant at the server. Having an appointment alone does not grant access. | Browser obtains scoped ciphertext/policy and requests decryption through the Tide SDK. |
| Sharing | A patient submits a GRANT/REVOKE intent; the API requires two distinct seeded admin identities to commit. | Independent admin sessions and Tide-enforced policy/quorum. |
| Transparency | Patient sees server access logs, including rejected attempts, approvals and commits. | Retain scoped audit metadata without logging plaintext or tokens. |

## Rules implemented by the frontend

- Simulation is an explicit mode with a visible banner, marked sign-in chooser and marked approval workspace. It never silently replaces failed real Tide authentication.
- Roles come from `/v1/me`, not the selected persona name or a client-edited role variable.
- Guest/private-page, patient/doctor/admin and record-specific checks remain separate. The API remains the authority.
- Simulated Bearer credentials are sent only to the configured API origin. Strict mode instead uses `IAMService.secureFetch`; it never creates a Bearer fallback.
- Two independently authenticated admin accounts supply distinct approval requests. The frontend neither increments the approval count nor makes a permission effective itself.
- Booking and clinical assignment do not automatically decrypt existing records. Each record is separate; granting one does not unlock the patient's history.
- Plaintext is removed from the UI when a record closes or the identity changes. Tokens, roles and health records are not written to browser storage.
- Revocation affects subsequent access; it cannot recall plaintext already obtained by a recipient.

## What the prototype does not prove

The simulated backend holds its AES key and uses SQLite to count approvals. Therefore the running prototype does not demonstrate real E2EE, an independently enforced cryptographic quorum, or protection against a malicious backend operator. Those guarantees require the real Tide network, signed policies, browser crypto and independent-admin acceptance tests. The real SDK path and relay are prepared, but live Tide login/DPoP/encryption remain unverified because the backend's licence/adapter setup is blocked.

See [README](README.md) for startup and the reproducible demo sequence. Current checks and handoff evidence are recorded in [agentdialogue.md](../agentdialogue.md).
