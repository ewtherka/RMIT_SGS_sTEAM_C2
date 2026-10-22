[![Built with TideCloak](https://tide.org/badges/built-with-tidecloak.svg)](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked)

## Project overview

CareFlow lets patients book clinic visits and share one medical record at a time with a new doctor, while no single administrator, clinic or AI can unlock that record alone.

Built with [TideCloak](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked).

### 1. Vision & originality

A patient-centred clinic app where booking a doctor and reading records are separate powers. Each record's access is a governed decision, not a database flag.

### 2. Trust constraint insight

Today a clinic admin, or anyone with database access, can read every record. Patients therefore cannot share selectively, and clinics must trust every insider. When access needs the patient's request plus independent approvals, a stolen admin account or rogue insider can no longer open records.

### 3. Value & impact

Patients reschedule without calling reception and share only what a new doctor needs. Example: Nguyễn An books BS. Lan for a follow-up. Lan reads last week's result only after An shares it and two independent admins approve, never An's whole history.

### 4. Why TideCloak matters

TideCloak signs users in, and the server verifies the roles in its JWTs. Records are stored as ciphertext; policy and quorum-enforced governance decide who decrypts. CareFlow requires 2 of 3 independent admins to commit any access change, so authority emerges only when the patient's request and the quorum align. In this prototype, TideCloak's sign-in, roles and access checks are **simulated** (`TIDE_MODE=simulated`), as the brief permits. Strict mode verifies real TideCloak JWTs and DPoP proofs.

### 5. Prototype & storytelling

Key interaction:
1. BS. Lan has an appointment, yet is **denied** the record.
2. An shares that one record with her.
3. Admin 1 approves: still denied, and admin 1 cannot approve twice.
4. Admin 2 approves. Quorum is reached and Lan decrypts the record.

Booking, rescheduling and slot conflicts run on a NestJS API with synthetic data.

## Setup

Requires Node.js 24+. Run both services on the same machine.

**Ready-to-record demo:** download [CareFlow-demo.zip](releases/CareFlow-demo.zip), extract it and double-click **START-DEMO.cmd** (Windows, Node.js 24+; Internet needed for the first dependency install). Both services start automatically in simulated mode. [Vietnamese recording guide](DEMO.md). This is a local web app, not a standalone executable.

Frontend: from `careflow-frontend/`, run `npm ci` then `npm run dev` (port 5173). Default mode uses the simulated backend at port 3333. See [frontend setup and demo](careflow-frontend/README.md).

Backend: from `careflow-backend/`:

```bash
cp .env.example .env    # set TIDE_MODE=simulated and a random QR_SIGNING_KEY
npm ci --ignore-scripts
npm run seed
npm start               # API on http://localhost:3333, Swagger at /docs
node scripts/sim-demo.mjs   # runs the quorum storyline end to end
```

All data is synthetic. Details: [Simulated TideCloak](careflow-backend/docs/SIMULATED_TIDE.md) · [Setup with real TideCloak](careflow-backend/docs/SETUP.md) · [Frontend API handoff](careflow-backend/docs/FRONTEND.md) · [Verification](careflow-backend/docs/VERIFICATION.md) · [OpenAPI](careflow-backend/docs/openapi.json)
