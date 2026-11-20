# COB-812 Better Auth — Production Deploy Runbook

Operational sequence for deploying the Better Auth migration (`002_better_auth.sql`) and the
claim/import code to production (Vercel + Neon). Drafted for supervisor approval; nothing here
is executed automatically.

## 1. Prerequisites

Vercel project environment variables set for the Production environment:

- `BETTER_AUTH_SECRET` — dedicated secret (e.g. `openssl rand -base64 32`)
- `BETTER_AUTH_URL` — the production origin
- `DATABASE_URL` — the Neon production connection string

## 2. Backup / restore point

Before migrating production data:

- Create a Neon branch point (or new branch) from the production branch, e.g. via the Neon
  console or `neonctl branches create --name pre-cob812 --parent <production-branch>`.
- Record the branch name and timestamp. Rollback (§5) restores `DATABASE_URL` to this branch.

## 3. Deploy order: migrate → code

`002_better_auth.sql` is additive-only (`CREATE TABLE IF NOT EXISTS`,
`ADD COLUMN IF NOT EXISTS`):

- **Old code tolerates the new schema** — extra tables and the unused
  `users.better_auth_user_id` column are ignored.
- **New code requires the tables** — Better Auth fails without them.

Therefore: run the migration first, then deploy the code.

1. Run `npm run db:migrate` against the production `DATABASE_URL` (applies `002_better_auth`).
2. Deploy the new code to Vercel.

## 4. Post-deploy verification

1. App responds: load the production origin; the Better Auth handler
   (`/api/auth/*`) responds without a 500 (no dedicated healthz endpoint exists).
2. Login path works: sign up / sign in via Better Auth at the production origin and confirm
   a session is established (`GET /api/auth/get-session` returns the session).
3. Claim: operator issues the owner claim token (`node scripts/generate-owner-claim.mjs`),
   the signed-in owner redeems it, and `users.better_auth_user_id` is bound to the
   Better Auth user.
4. Import gate state: `/import` loads; an unauthenticated import attempt is denied before
   touching the DB; an authenticated, claimed-session import persists rows.

## 5. Rollback

1. **Revert code:** redeploy the previous Vercel deployment (old code tolerates the new schema,
   so no immediate DB action is required).
2. **Drop the Better Auth tables:** run the ROLLBACK section at the bottom of
   `db/migrations/002_better_auth.sql` (drops `owner_claims`, `better_auth_*` tables and the
   `users.better_auth_user_id` column), and delete the `002_better_auth` row from
   `schema_migrations` so a later re-run of the migrator re-applies it.
3. **Restore the database:** if data was mutated, point `DATABASE_URL` back at the pre-migration
   Neon branch from §2.

## 6. Production beta (two-user: owner + Jason) — added 2026-11-19

Target: usable two-user production beta. New users provision their own collection at
`/provision` (no claim token); the legacy owner still binds exclusively via `/claim` + token.

### 6.1 Code state

- `93b9609` — reviewed G4 fix-ups (recovery docs, self-contained integration suite, runbook).
- `ea1a410` — new-user provisioning (`provisionNewCollection` + server action + 5 unit tests).
- `917b7fb` — signup lands on `/provision` (blocker-1 fix); `/claim` unchanged for legacy owner.

### 6.2 Beta gates (each requires explicit GO)

- **G-1 Independent review** of `ea1a410` + `917b7fb` (provisioning security: no UPDATE path
  on existing users rows, AlreadyProvisionedError idempotence, claim-flow exclusivity).
- **G-2 Disposable-branch E2E** on `pkmn-better-auth-it`: migrate 002 (if unapplied), production
  build + server, signup → session → provision → CSV import → isolation + fail-closed checks.
- **G-3 Push** reviewed commits to the fork (updates PR #2) OR push the branch to the origin
  repo (`idislikebrian/pkmn-investing`) — the origin-branch route bypasses Vercel fork
  authorization entirely and is the recommended simpler path for the beta.
- **G-4 Brian merges** PR #2 into `main` from his own GitHub account.
- **G-5 Production env vars** (Vercel Production): `BETTER_AUTH_SECRET` (fresh 32+ byte),
  `BETTER_AUTH_URL` (production origin), `DATABASE_URL` (production Neon), and — only after
  G-6 — `IMPORT_E2E_VERIFIED=1`.
- **G-6 Neon backup point**: create branch `pre-cob812-beta` from production before migrating.
- **G-7 Migrate**: `npm run db:migrate` against production `DATABASE_URL` (additive-only 002).
- **G-8 Deploy**: Vercel production deployment of merged `main`.
- **G-9 Owner claim**: owner signs in, redeems operator-issued claim token for the legacy row.
- **G-10 Import gate open**: operator sets `IMPORT_E2E_VERIFIED=1` (production env) after
  post-deploy verification §4 passes.
- **G-11 Jason signup**: Jason signs up → `/provision` → imports CSV → isolation verified.

### 6.3 Beta rollback

Runbook §5 applies unchanged: revert code deploy first (old code tolerates new schema),
then optionally run the 002 ROLLBACK section + delete the `schema_migrations` row, and/or
restore `DATABASE_URL` to the `pre-cob812-beta` branch point. Jason's provisioned row and
any imported cards live only in rows created post-migration — reverting the column/tables
orphan-nothing because the legacy owner data is untouched by 002 (additive-only).
