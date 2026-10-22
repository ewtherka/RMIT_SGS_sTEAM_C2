# CareFlow demo bundle

[Download CareFlow-demo.zip](https://github.com/ewtherka/RMIT_SGS_sTEAM_C2/raw/refs/heads/main/releases/CareFlow-demo.zip) · [Hướng dẫn quay tiếng Việt](../DEMO.md)

Extract, install Node.js 24+ if needed, then double-click `START-DEMO.cmd` on Windows. The first run needs Internet to install backend dependencies. This is a local web app, not a standalone EXE. Open http://localhost:5173. TideCloak is explicitly simulated; use synthetic data only.

Contains prebuilt React frontend, compiled backend, vendor relay, pinned dependency manifests and a local launcher. No database, secrets, adapter credentials or node_modules. SHA256 is in `CareFlow-demo.sha256`; verify from this folder using `sha256sum -c CareFlow-demo.sha256`.

Verified on Linux with a fresh bundle database and separately installed production dependencies: startup, second-start reuse, 15 main browser scenarios, 4 emergency scenarios. Frontend has 8 unit tests; local static host has 6 checks, including exact Tide relay bytes/headers. Native Windows launch has been handed to agent D for verification and is not claimed as tested by A.

Maintainer rebuild from the full source checkout: build both projects, then `node scripts/package-demo.mjs` (requires the `zip` utility). Packaging uses an explicit allowlist; build outputs are included only inside this archive.
