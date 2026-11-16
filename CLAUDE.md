# CLAUDE.md — Offline-First Disaster Relief Distribution & Coordination System

Software Engineering Capstone. Next.js 15 (App Router) + TypeScript + PostgreSQL + Prisma 6 + Dexie.js (IndexedDB PWA).
These rules are binding for every session. If a request conflicts with them, say so before writing code.

---

## 0. Commands

```bash
npm run dev          # next dev on :3000
npm run typecheck    # tsc --noEmit — must pass before every commit
npm run lint         # eslint — must pass before every commit
npm run build        # prisma generate + next build — must pass before every push
npm run db:migrate   # prisma migrate dev (creates + applies a migration)
npm run db:seed      # prisma db seed — TRUNCATES all tables, then seeds
npm run db:reset     # drop, re-migrate, re-seed
npm run test:api     # end-to-end API test against a running server (API_BASE, default :3000). RE-SEEDS THE DB.
npm run test:field   # Playwright field-app test at 360×740 against a PRODUCTION server (npm run build && npm start). RE-SEEDS THE DB.
```

`npm run test:api` must pass before every push that touches `src/app/api` or `src/lib`.
`npm run test:field` must pass before every push that touches `src/app/field`, `src/components/field`,
`src/lib/field`, `src/lib/offline-*`, `src/hooks` or `public/sw.js`. Use a production build: the service
worker only registers in production. `playwright` is pinned to the preinstalled browser's version (1.63.0) —
never upgrade it or run `playwright install`.

Local DB: copy `.env.example` → `.env`. Postgres 16 is expected at `DATABASE_URL`.

### Demo accounts (sign in with mobile number)

| Role | Name | Mobile | Password | Status |
|---|---|---|---|---|
| SYSTEM_ADMINISTRATOR | Tanvir Ahmed | 01700000001 | `SysAdmin@2026` | Active |
| OPERATION_ADMINISTRATOR | Nusrat Jahan | 01700000002 | `OpsAdmin@2026` | Active |
| OBSERVER | Farhana Akter | 01700000005 | `Observer@2026` | Active |
| GROUP_COORDINATOR (Shobuj Bangla Relief) | Rafiqul Islam | 01711000010 | `Coordinator@2026` | Active |
| FIELD_VOLUNTEER (Shobuj Bangla Relief) | Sumaiya Rahman | 01711000011 | `Volunteer@2026` | Active |
| GROUP_COORDINATOR (Feni Youth Volunteers) | Jannatul Ferdous | 01811000021 | `Coordinator@2026` | Active |
| FIELD_VOLUNTEER (Feni Youth Volunteers) | Mahmudul Hasan | 01811000020 | `Volunteer@2026` | Active |
| GROUP_COORDINATOR (Delta Aid Foundation) | Shirin Sultana | 01911000031 | `Coordinator@2026` | Active |
| FIELD_VOLUNTEER (Delta Aid Foundation) | Arif Hossain | 01911000030 | `Volunteer@2026` | Active |
| FIELD_VOLUNTEER | Kamrul Hasan | 01811000022 | `Volunteer@2026` | Locked (15 min from seed time) |
| FIELD_VOLUNTEER | Tahmina Akter | 01711000012 | `Volunteer@2026` | Deactivated (device Revoked) |
| GROUP_COORDINATOR (Cumilla Flood Response) | Shahidul Alam | 01611000040 | `Coordinator@2026` | PendingApproval |

These passwords are for local/demo databases only. Never seed them into production.

---

## 1. Zero AI-Slop Aesthetic (non-negotiable)

The UI is a utilitarian humanitarian operations tool used outdoors on cheap Android phones in direct sunlight.
Reference points: KoboToolbox, Ushahidi, Linear. Reference points are **not**: SaaS landing pages, crypto dashboards.

**Forbidden** — reject these even if a component library suggests them:
- Purple/blue/any gradients (backgrounds, text, borders, buttons).
- Glassmorphism, `backdrop-blur`, translucent surfaces, frosted panels.
- Floating "hero" cards, marketing copy, taglines, decorative illustrations, emoji, blobs, mesh backgrounds.
- KPI/summary stat cards above operational queues unless the user explicitly requested that specific card.
  Queues (conflicts, duplicates, flags, approvals) open directly on the table/list of work.
- Drop shadows beyond none. Separation is done with 1px `#CBD5E1` borders.
- Radii above 6px. No `rounded-lg`/`rounded-xl`/`rounded-full` on containers or buttons
  (`rounded-full` is acceptable only for a literal circular indicator dot).
- Animated entrances, skeleton shimmer, confetti, toasts that hide errors.
- Icon-only buttons without an accessible label; icons are `lucide-react` only.

**Required**:
- Dense, scannable tables with left-aligned text and right-aligned numbers.
- Every destructive or state-changing action states its consequence in plain words and, where the
  state diagram is irreversible (Void, Reject, Link, Close operation), asks for confirmation in a `Dialog`.
- Empty states are one sentence of instruction text, not illustrations.
- Errors are shown inline next to the field/row that caused them, in crimson text, and never swallowed.
- Touch targets ≥ 40px tall on field-volunteer screens (`h-10` minimum; `h-12` for primary field actions).

## 2. Design tokens

Defined once in `src/app/globals.css` (`@theme`). Use the Tailwind token names, never raw hex in components.

| Token | Value | Tailwind |
|---|---|---|
| Canvas | `#F8FAFC` | `bg-canvas` |
| Surface | `#FFFFFF` | `bg-surface` |
| Border | `1px solid #CBD5E1` | `border border-line` |
| Text | `#0F172A` / muted `#475569` | `text-ink` / `text-ink-muted` |
| Primary action | Deep Civic Teal `#0F766E` | `bg-primary` |
| Primary hover | `#115E59` | `hover:bg-primary-hover` |
| Radius | 4px / 6px max | `rounded-sm` / `rounded-md` |

### Status badges — `src/components/status-badge.tsx` is the only place state → colour is decided

| Tone | Colours | States (exact enum values / client sync states) |
|---|---|---|
| Amber | `#B45309` on `#FEF3C7` | `Pending`, `Uploading`, `PendingApproval`, `PendingReview` |
| Forest green | `#15803D` on `#DCFCE7` | `Acknowledged`, `Active`, `Approved`, `Resolved`, `Linked`, `Justified`, `Served` |
| Crimson | `#B91C1C` on `#FEE2E2` | `Open` (conflict), `Failed` (retryable), `Locked`, `Rejected`, `Voided`, `Repeat`, `Revoked` |
| Slate | `#475569` on `#F1F5F9` | `Closed`, `Deactivated`, `NotDuplicate`, `Unserved`, `NoRecords` ("No Records") |

Always render status via `<StatusBadge status=… locale=… />`. Adding a new state means adding it to
`STATUS_TONE` **and** `STATUS_LABELS` (both languages). `StatusBadge` throws on unmapped states by design.

## 3. Typography & bilingual (NFR18)

- Fonts: `Inter` (Latin) + `Hind Siliguri` (Bangla), loaded via `next/font/google` in `src/app/layout.tsx`.
- Apply the `num` utility (tabular-nums) to every `short_code`, `mobile_number`, `score`, count, quantity,
  date and ward number.
- Data values are never translated: `short_code`, `mobile_number`, `head_name`, scores and counts always use
  Latin digits (use `bn-BD-u-nu-latn` for `Intl` formatters in Bangla).
- Every header contains the `EN | বাংলা` `<LocaleToggle>`. Locale is stored in the `locale` cookie and read
  server-side via `getLocale()`; switching never navigates away or loses form state.
- All UI strings live in `src/lib/i18n/dictionary.ts` with both `en` and `bn` entries. No hard-coded
  English strings in components. Consent script and coverage labels (upazila/union names) **must** have
  Bangla versions; render Bangla text with the `font-bangla` utility.
- `head_name` is captured in English letters only (DB CHECK `^[A-Za-z][A-Za-z .'-]*$`).

## 4. No stubs, no placeholders

- Never write `// TODO`, `// FIXME`, `throw new Error("not implemented")`, `console.log` handlers,
  `href="#"`, lorem ipsum, or buttons that do nothing.
- Every use case UC-01 … UC-25 from the capstone specification must work end-to-end: UI → validated
  server action/route handler → Prisma → audit log → notification (where relevant) → offline path (where relevant).
- UC numbers and wording come from the capstone specification. Do not guess a UC's scope from its number —
  if the spec text is not available in the session, ask the user for it.
- If a feature cannot be completed in the current session, do not merge partial UI for it. Say what is missing.

## 5. Architecture rules

### 5.1 Layout
```
prisma/schema.prisma        ERD Fig 5.15 / Class Diagram Fig 5.16 (source of truth for data)
prisma/migrations/          SQL migrations incl. append-only triggers and CHECK constraints
prisma/seed.ts              Destructive demo seed
src/app/                    App Router routes (server components by default)
src/components/ui/          shadcn-style primitives (hand-copied; registry is not reachable from CI)
src/components/             App components (StatusBadge, LocaleToggle, …)
src/lib/db.ts               Prisma singleton — the only place PrismaClient is constructed (seed excepted)
src/lib/i18n/               Dictionary + server locale reader
```

### 5.2 Data rules (enforced in DB — do not work around them)
- Prisma models are camelCase but map to the exact ERD table/column names (`@@map`/`@map`). Never rename
  a mapped column without a migration and a spec reason.
- Additive columns beyond the ERD, each required by a requirement: `user.must_change_password` (NFR03),
  `household.updated_at` / `distribution.updated_at` (delta download), `operation.pii_purged_at` (NFR07),
  and table `unserved_release` (UC-21). Do not add more without the same justification.
- `audit_log` and `household_version` are **append-only**: DB triggers reject UPDATE/DELETE. Every
  state-changing operation writes an `AuditLog` row in the same transaction (`old_value`/`new_value` as JSON).
  The only exception is `src/lib/purge.ts`, which sets `SET LOCAL app.pii_purge = 'on'` and may only
  overwrite PII columns with redacted values. DELETE is never allowed. Never use that flag anywhere else.
- Notification `message` text must never contain PII (names, phone numbers). Use short codes.
- Every household change (field edit or conflict resolution) increments `household.version` and inserts a
  `HouseholdVersion` row with `change_source` `FIELD_EDIT` or `CONFLICT_RESOLUTION` — in one transaction.
- `duplicate_pair` stores pairs in canonical order (`household_a_id < household_b_id`, CHECK constraint).
- `distribution`: anonymous ⇔ `household_id IS NULL`; `Voided` requires a non-empty `cancel_reason`.
  Distributions are voided, never deleted.
- Mobile numbers: `^01[3-9][0-9]{8}$`. Household consent must be `true` and timestamped.
- `short_code` format `FN-####`, unique, generated server-side; offline devices create households with a
  UUID and receive the short code on sync acknowledgement.

### 5.3 Offline-first sync (Dexie ↔ `/api/sync`)
- Field volunteers must be able to register households and record distributions with zero connectivity.
  Writes go to Dexie first, then into an outbox; the UI never waits on the network for these flows.
- Each outbox entry has a client-generated UUID that becomes `sync_event.event_id`. The server treats a
  repeated `event_id` as already applied and returns the original result (idempotent replay).
- Client-side outbox states: `Pending` → `Uploading` → `Acknowledged` | `Failed` (retryable). These are the
  badge states in §2. Retries use exponential backoff; a `Failed` entry is never silently dropped.
- Updates carry `base_version`. On the server:
  - `base_version == household.version` → apply, bump version.
  - stale `base_version` and the changed field was **not** modified since `base_version` → auto-merge.
  - stale `base_version` and the **same field** was modified → create one `CONFLICT` row per field
    (`Open`), keep the server value, notify the group coordinator. Resolution writes a
    `CONFLICT_RESOLUTION` version.
- Devices with `status = Revoked`, or whose user is not `Active`, are rejected by `/api/sync` (401) and the
  attempt is audited.

### 5.4 Detection rules
- Duplicate households (`src/lib/detection/`): compared within the same union of an operation. Score =
  weighted name similarity (Jaro-Winkler + fuzzy token overlap, honorifics like Md/Mst ignored) 0.45,
  mobile exact/last-6 match 0.25 (dropped and re-weighted when either is missing), same ward 0.15,
  member-count proximity 0.15. `≥ DUPLICATE_LIKELY_THRESHOLD` (0.85) → `Likely`,
  `≥ DUPLICATE_POSSIBLE_THRESHOLD` (0.65) → `Possible`, lower → no pair. Pairs start `PendingReview`;
  reviewed pairs are never reopened by a rescan. `Linked` households count as one family for flags.
- Repeat distribution flag: same household (or a Linked duplicate), two `Active` distributions sharing at
  least one `item_id`, recorded by users of **different organisations** within
  `REPEAT_DISTRIBUTION_WINDOW_HOURS` (24h) → `DISTRIBUTION_FLAG` `PendingReview`, created in the same
  transaction as the distribution.
- Void window (UC-15): only the recording volunteer, only within `VOID_WINDOW_HOURS` (24h) of
  `distributed_at`, measured to the void event's `client_time`. Voided rows are kept with `cancel_reason`.

### 5.5 Auth & roles
- Login by `mobile_number` + password. `bcryptjs` hashes (cost ≥ 10). Sessions are HS256 JWTs signed with
  `jose` using `AUTH_JWT_SECRET`, stored in an `httpOnly`, `secure`, `sameSite=lax` cookie.
- After `AUTH_MAX_FAILED_ATTEMPTS` (5) consecutive failures the user becomes `Locked` with
  `locked_until = now + AUTH_LOCKOUT_MINUTES` (15). An expired lock clears itself at the next sign-in.
  Only `Active` users can sign in. A temporary password sets `must_change_password`; every API except
  `/api/auth/me`, `/api/auth/change-password` and `/api/auth/logout` returns `PASSWORD_CHANGE_REQUIRED` until it is changed.
- `authenticate()` re-reads user status and device status from the DB on every request, so deactivation,
  locking and device revocation take effect on existing sessions immediately.
- Permissions live in `src/lib/auth/rbac.ts` (`PERMISSIONS`). Handlers call `requirePermission(req, "...")`
  and then `assertOrgScope` for coordinator-scoped records. Never check roles ad hoc in handlers.
- NFR06: households only leave the API through `serializeHousehold()`, which masks `mobile_number`
  (`017XX-XXX892`) unless the caller's organisation registered the household.
- Authorisation is checked on the server for every action (never only by hiding UI). Roles:
  `FIELD_VOLUNTEER`, `GROUP_COORDINATOR`, `OPERATION_ADMINISTRATOR`, `SYSTEM_ADMINISTRATOR`, `OBSERVER`
  (read-only, aggregate views only — never household PII).
- Coordinators act only on records belonging to their own organisation.

### 5.6 API map (all handlers wrapped in `route()` from `src/lib/api.ts`)
Errors are always `{ "error": { "code", "message", "details" } }`. Mutating requests with a foreign
`Origin` header are rejected (CSRF), on top of `SameSite=Lax` cookies.

| Endpoint | Who | Purpose |
|---|---|---|
| `POST /api/auth/register`, `register-org`, `login`, `logout`; `GET /api/auth/organisations` | public | UC-01..03 |
| `GET /api/auth/me`, `POST /api/auth/change-password` | any signed-in | session, NFR03 |
| `POST /api/auth/reset-temp-password` | GC (own org, field roles), SA | NFR03 temp password + unlock |
| `POST /api/sync` | FV, GC | outbox upload + delta download (see `src/lib/sync/`) |
| `GET/POST /api/operations`, `GET/PATCH /api/operations/[id]` | read: all; write: OA | create / close |
| `GET/POST /api/operations/[id]/setup` | OA (GC: `requestMembership`) | areas, CSV import, items, memberships |
| `POST /api/operations/pii-purge` | SA | NFR07 (dry run by default) |
| `GET /api/organisations`, `PATCH /api/organisations/[id]` | SA | approve / reject |
| `GET/POST /api/members`, `GET/PATCH /api/members/[id]` | GC (own org), SA | approve, reject, role, deactivate, revoke device |
| `GET /api/households`, `GET/PATCH /api/households/[shortCode]` | FV/GC/OA read; GC edit | search, history, online edit |
| `GET /api/conflicts`, `POST /api/conflicts/[id]/resolve` | GC (own org), OA | UC-17 |
| `GET /api/duplicates`, `POST /api/duplicates/[id]`, `POST /api/duplicates/scan` | GC, OA | State Diagram 06 |
| `GET /api/flags`, `POST /api/flags/[id]/review` | GC, OA | FR20 |
| `GET /api/coverage`, `POST /api/coverage/release-unserved` | all / GC, OA | UC-20, UC-21 |
| `GET/PATCH /api/notifications` | own | list, mark read |
| `GET /api/audit` | GC (own org), OA, SA | filters + `format=csv`; no write routes exist |
| `GET /api/reports?type=organisation\|summary&format=json\|csv\|html` | GC / OA, OB | summary is anonymised |

### 5.7 Sync contract (`POST /api/sync`)
Request `{ operationId, deviceId, since?, areaIds[], events[] }`, max 200 events. Each event
`{ eventId, entityType, entityId, action, payload, baseVersion, clientTime }`. Supported: HOUSEHOLD CREATE/UPDATE,
DISTRIBUTION CREATE/VOID. Response: `acknowledgedIds` (applied + already-seen; delete these from the
outbox), `rejected[]` with `retryable`, `householdShortCodes`, `conflicts`, and `delta` (store
`delta.nextSince` as the next `since`). Each event commits in its own transaction.

### 5.8 Field app (`/field`, FIELD_VOLUNTEER + GROUP_COORDINATOR)
- Target 360–412 px Android screens. Touch targets ≥ 52 px on field screens; primary actions at the bottom.
- Every `/field/*` page renders `src/components/field/field-screen.tsx`; screens switch on the pathname via
  `history.pushState` (`navigate()` in `useField()`). Never use `<Link>`/`router.push` inside `/field`: a server
  round-trip fails offline and a hard navigation drops the in-memory vault key.
- Storage (`src/lib/offline-db.ts`, Dexie `relief-field`): household PII (`head_name`, `mobile_number`,
  `gps_location`) and every outbox payload are AES-GCM encrypted (`src/lib/offline-crypto.ts`). The data key
  lives in memory only while unlocked and is wrapped twice: by a PBKDF2 key from the 4-digit PIN (offline
  unlock, 7-day expiry, 5 attempts) and by one from the account password (recovery after lockout/expiry).
  Never store PII in plaintext tables, `meta`, `localStorage` or the HTTP cache.
- Short codes: offline registrations show a device-unique `TMP-####` on the slip; it is replaced by the
  server's `FN-####` from `householdShortCodes` on sync acknowledgement (server stays the only FN issuer).
- Sync (`src/lib/field/sync.ts`, `src/hooks/useSyncEngine.ts`): batches of 10, single-flight, per-event
  states Pending → Uploading → Acknowledged | Failed (retryable, exponential backoff) | Rejected
  (non-retryable, discard only via confirmation). Network loss mid-batch returns the batch to Pending.
  Offline edits are coalesced into the not-yet-uploaded CREATE/UPDATE of the same household.
  `applyDelta` never overwrites records that still have unacknowledged outbox events.
- All field network calls go through `fieldFetch()` so the Offline Mode Simulator blocks them.
- `public/sw.js` caches the `/field` shell and its `/_next/static` assets; `/api/*` is never cached.

### 5.9 Route map for UI pages (notification `link_path` values depend on these)
`/conflicts/[id]`, `/duplicates/[id]`, `/flags/[id]`, `/households/[shortCode]`,
`/operation`, `/operation/memberships`, `/admin/organisations`, `/admin/users`, `/field/unserved`.

## 6. Code conventions
- TypeScript strict; no `any`, no `@ts-ignore`. Validate every request body with `zod` at the boundary.
  Sole exception: `scripts/api-smoke.ts` may use `any` for untyped HTTP response JSON.
- Server components by default; `"use client"` only for interactivity, Dexie and the locale toggle.
- Prisma writes that touch more than one table go through `prisma.$transaction`.
- CSV import/export uses `papaparse`; exports never include `password_hash` or device secrets.
- Times are stored as `timestamptz` (UTC) and displayed in `Asia/Dhaka`.
- Commit only when typecheck, lint and build pass.
