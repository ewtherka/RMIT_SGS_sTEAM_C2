# Simulated TideCloak (`TIDE_MODE=simulated`)

The UNLOCKED brief allows simulating TideCloak's sign-in, roles and access checks, and judges simulated and live integrations the same way. CareFlow is built as though TideCloak protects it. Every simulated response carries `SIMULATED` / `SIMULATED_TIDECLOAK`; nothing claims to be the real Tide network. `TIDE_MODE=strict` (the default) keeps the real TideCloak JWT + DPoP path unchanged.

## Where TideCloak fits (planned with Tide's Raziel MCP, `feature-mapping` canon)

| Concern | Real TideCloak | Simulated here | Why it matters |
| --- | --- | --- | --- |
| Sign-in | Threshold-verified login; JWT signed by the VVK across ORKs | `POST /v1/sim/session` issues a TideCloak-shaped JWT (`realm_access.roles`, `tideuserkey`, `azp/aud`) | No password hash or master signing key at the clinic |
| Roles | Verified server-side from the JWT | Same guard path: the server verifies the token and reads `careflow-*` roles; UI gating is never authorization | Front-end role toggles grant nothing |
| Record access | Forseti policy + E2EE; decryption needs the network | `POST /v1/sim/records/:id/decrypt` returns plaintext only for the patient, the authoring doctor or a quorum-granted doctor; otherwise `403 TIDE_POLICY_DENIED` | The clinic database holds ciphertext only |
| Changing access | Quorum-enforced governance (IGA change request) | Patient files `GRANT`/`REVOKE` → **2 of 3 independent admins** must approve → `COMMITTED` | No single admin, clinic or AI can unlock a record alone |

### Tide MCP findings (for review)

Agent D queried Tide's remote MCP (`https://mcp.tide.org/mcp`, `@tideorg/mcp` 1.9.33) over HTTP on 2026-10-22. The calls were `initialize`, `tools/list` and `tide_canon {name:"feature-mapping"}`. Points applied here:

- *"UI gating is NOT authorization. Protected routes are NOT protected APIs."* Every role and access decision is made on the server; the front-end may only hide buttons.
- Real authorization means verifying the TideCloak-signed JWT on the server, using the adapter's embedded JWKS. The simulated guard keeps that same shape: one verified token, with roles read from `realm_access.roles`.
- Login UX is not the differentiator. The Tide properties are threshold verification (no password hash, no single signing key), E2EE and Quorum-Enforced Governance. CareFlow's demo therefore centres on quorum-gated decryption, not the login screen.
- Install for agents: `claude mcp add tide-pack -- npx -y @tideorg/mcp`. Agent A's cloud environment could not reach the MCP (proxy `CONNECT 403`).

### Honest limits of the simulation

- In simulated mode the backend derives the AES-GCM keys from `.data/sim-tide.secret`. An operator holding that file could decrypt every record, so this is **not** real E2EE or cryptographic quorum. It stands in for what the Tide Fabric enforces with keys that no single party holds.
- Approval counting happens in SQLite. On real Tide, quorum is enforced by threshold signatures across independent ORKs, not by a database counter.
- UI and video must keep the `SIMULATED` label and must not claim the real server cannot read data.

### Scope rules (enforced server-side)

- **Patient owner:** can decrypt, view `access` with all requests and grants, and view `access-log`.
- **Admin of the clinic:** sees requests, grants and `access-log`, and approves changes. Decrypting returns `403 TIDE_POLICY_DENIED`, because governing access never includes reading.
- **Doctor:** can decrypt as the record's author or after a quorum grant. A doctor with an active appointment but no grant gets `403`. Doctors never see other doctors' grants or requests.
- **Anyone else in the clinic** (another patient, a receptionist, an unrelated doctor) gets `404`, so the record's existence is not revealed.

## Run

```bash
cp .env.example .env    # then set TIDE_MODE=simulated and QR_SIGNING_KEY
npm ci --ignore-scripts && npm run seed && npm start
node scripts/sim-demo.mjs   # end-to-end demo of the quorum flow
```

On first start in simulated mode the two seed records are encrypted (AES-256-GCM, a key derived per record from a secret in `.data/sim-tide.secret`, which is outside Git) and released.

## API for the front-end

Private calls use `Authorization: Bearer <accessToken>` (no DPoP in simulated mode). All other `/v1` endpoints keep the contract in `FRONTEND.md`.

| Method | Path | Who | Response |
| --- | --- | --- | --- |
| GET | `/v1/auth/config` | public | `{configured:true, mode:"SIMULATED", tokenType:"Bearer", identitiesPath, sessionPath, quorum:{threshold:2,of:3}}` |
| GET | `/v1/sim/identities` | public | `[{userId, displayName, roles:["careflow-patient"\|...]}]` |
| POST | `/v1/sim/session` | public | body `{userId}` → `{mode, tokenType:"Bearer", accessToken, expiresIn, userId, roles}` |
| GET | `/v1/sim/approvals` | admin | `{quorum, items:[AccessRequest]}`: requests still `PENDING_TIDE` |
| POST | `/v1/sim/approvals/:id/approve` | admin | `AccessRequest`; `409 ALREADY_APPROVED` if the same admin approves twice; `409 REQUEST_CLOSED` once committed |
| GET | `/v1/sim/records/:id/access` | patient/doctor/admin | `{recordId, canDecrypt, allowedBy, grantedDoctorIds, requests, quorum}` |
| POST | `/v1/sim/records/:id/decrypt` | patient/doctor | `{recordId, plaintext, allowedBy:"PATIENT_USER_POLICY"\|"AUTHOR_CARE_TEAM"\|"QUORUM_GRANT"}` or `403 TIDE_POLICY_DENIED` (denials are logged) |
| GET | `/v1/sim/records/:id/access-log` | patient owner/admin | `{recordId, items:[{action, actorId, actorName, details, at}]}` where `action` ∈ `ACCESS_INTENT_SUBMITTED`, `SIM_TIDE_APPROVAL`, `SIM_TIDE_QUORUM_COMMITTED`, `SIM_TIDE_DECRYPT`, `SIM_TIDE_DECRYPT_DENIED`; newest first |

`AccessRequest` = `{id, recordId, recordTitle, doctorId, doctorName, intent:"GRANT"|"REVOKE", status:"PENDING_TIDE"|"COMMITTED", approvals:[{adminId, displayName, approvedAt}], quorum:{threshold, of, reached}, createdAt, enforcedBy}`.

The patient still creates requests with the existing `POST /v1/records/:id/access-requests {doctorId, intent}`. A `GRANT` requires an active appointment with that doctor, so book first.

### Seed identities

| userId | Who | Role |
| --- | --- | --- |
| `30000000-0000-4000-8000-000000000001` | Nguyễn An (patient) | careflow-patient |
| `30000000-0000-4000-8000-000000000002` | BS. Minh (author of the seed records) | careflow-doctor |
| `30000000-0000-4000-8000-000000000003` | BS. Lan (new doctor, no access yet) | careflow-doctor |
| `30000000-0000-4000-8000-000000000004` | Receptionist | careflow-receptionist |
| `30000000-0000-4000-8000-000000000005..7` | Independent admins 1–3 | careflow-admin |

## Two-minute demo storyline

1. Patient signs in (simulated) → books BS. Lan.
2. BS. Lan opens the patient's result → **denied by Tide** even though she has an appointment.
3. Patient shares that one record with BS. Lan → `PENDING_TIDE`.
4. Admin 1 approves → still denied (1/2). Admin 1 cannot approve twice.
5. Admin 2 approves → quorum reached → BS. Lan decrypts the result. The patient's second record stays locked.
6. The patient opens the access log and sees Lan's denied attempt, both approvals and Lan's successful read.
7. Message: the clinic's admins, its database and its AI cannot unlock a patient's record alone.

Automated proof: `npm test` includes `test/simulation.test.ts`. It covers forged-token rejection, 404 scoping, admin-cannot-read, the 1/2 → 2/2 quorum path, a one-record-only grant, revoke after quorum and the access log.
