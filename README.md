# Offline-First Disaster Relief Distribution & Coordination System

Next.js 15 (App Router) · TypeScript · PostgreSQL · Prisma 6 · Dexie.js (offline IndexedDB PWA).

## Setup

```bash
cp .env.example .env          # then set DATABASE_URL and AUTH_JWT_SECRET
npm install
npm run db:migrate            # applies prisma/migrations (incl. append-only triggers)
npm run db:seed               # demo operation: Feni & Noakhali Flash Flood Response 2026
npm run dev
```

Demo accounts, design rules, architecture rules and the API map are in [`CLAUDE.md`](./CLAUDE.md).

## Field app

Open `/field` on a phone (or a 360 px wide browser window), sign in as a field volunteer
(e.g. `01711000011` / `Volunteer@2026`), set a PIN, download wards under **Sync**, and work offline.
The top bar has an **Offline simulator** switch for demonstrating offline behaviour.

## Testing the API

```bash
npm run build && npm start     # in one terminal
npm run test:api               # in another — re-seeds the database, then exercises every endpoint
npm run test:field             # field app in a 360×740 browser, incl. real offline reloads
```

## Seed contents

- 1 active operation, 6 areas (Feni Sadar, Parshuram); Chhagalnaiya Ward 05 has no households ("No Records")
- 5 relief items; 3 approved organisations + 1 pending
- 12 users covering all 5 roles and the Active / Locked / Deactivated / PendingApproval states
- 25 households with version history, 18 distributions (1 anonymous, 1 voided)
- 2 open same-field conflicts (+1 resolved), 2 duplicate pairs (0.88 Likely, 0.71 Possible),
  1 cross-organisation 24-hour distribution flag, notifications and an append-only audit trail
