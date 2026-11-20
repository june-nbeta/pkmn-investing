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

## 6. Production beta (two-user: owner + Jason) — added 2026-11-19, re-sequenced 2026-11-19 20:19

Target: usable two-user production beta. New users provision their own collection at
`/provision` (no claim token); the legacy owner still binds exclusively via `/claim` + token.

**CRITICAL ORDERING (supervisor correction):** Vercel automatically deploys `main` the moment
the beta branch merges. Therefore production environment variables (G-4), the verified Neon
restore point (G-5), and the additive `002` migration (G-6) **MUST all complete BEFORE the
merge** (G-7). Migrating before merging is safe because `002` is additive-only: the currently
deployed old code ignores the new tables and the unused `users.better_auth_user_id` column, so
the running application is preserved throughout the migration window. The import gate stays
disabled (`IMPORT_E2E_VERIFIED` unset) until post-deploy verification passes (G-10), so no
production import traffic can occur during the transition. G-8 is the manual post-deploy
verification run AFTER Vercel's automatic deployment — Vercel deploys by itself; G-8 is the
human check that it deployed correctly.

### 6.1 Code state

- `93b9609` — reviewed G4 fix-ups (recovery docs, self-contained integration suite, runbook).
- `ea1a410` — new-user provisioning (`provisionNewCollection` + server action + 5 unit tests).
- `917b7fb` — signup lands on `/provision` (blocker-1 fix); `/claim` unchanged for legacy owner.

### 6.2 Beta gates (each requires explicit GO)

- **G-1 Independent review** of `ea1a410` + `917b7fb` (provisioning security: no UPDATE path
  on existing users rows, AlreadyProvisionedError idempotence, claim-flow exclusivity).
- **G-2 Disposable-branch E2E** on `pkmn-better-auth-it`: migrate 002 (if unapplied), production
  build + server, signup → session → provision → CSV import → isolation + fail-closed checks.
- **G-3 Push** reviewed commits to the fork (updates PR #2) OR owner pushes the branch to the
  origin repo (`idislikebrian/pkmn-investing`) — the origin-branch route bypasses Vercel fork
  authorization entirely and is the recommended simpler path for the beta (owner-authorized
  push procedure in §6.4; no agent credential expansion).
- **G-4 Production env vars** (Vercel Production): `BETTER_AUTH_SECRET` (fresh 32+ byte),
  `BETTER_AUTH_URL` (production origin), `DATABASE_URL` (production Neon). Do NOT set
  `IMPORT_E2E_VERIFIED` yet — the import gate stays disabled until G-10.
- **G-5 Neon backup point**: create branch `pre-cob812-beta` from production; record branch
  name + timestamp (this is the verified restore point).
- **G-6 Migrate**: `npm run db:migrate` against production `DATABASE_URL` (additive-only 002;
  the currently deployed old application keeps running unchanged — additive migration, no
  downtime window).
- **G-7 Brian merges** PR #2 / the beta branch into `main` from his own GitHub account.
  Vercel auto-deploys `main` — this is the production deploy (G-8 happens automatically).
- **G-8 Post-deploy verification**: run §4 checks against the auto-deployed production.
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

### 6.4 Owner-authorized push procedure (origin-branch route, no agent credential expansion)

The agent's GitHub identity (june-nbeta) has push access to the fork (june-nbeta/pkmn-investing)
only — verified working. It has no push access to the origin repo (idislikebrian/pkmn-investing)
and must never gain it. The owner performs the origin push from their own machine:

1. Owner fetches the reviewed branch from the fork and pushes it to the origin repo:
   ```
   git fetch https://github.com/june-nbeta/pkmn-investing.git dev/cob812-auto-provision
   git push https://github.com/idislikebrian/pkmn-investing.git \
     FETCH_HEAD:refs/heads/dev/cob812-auto-provision
   ```
   (Or, with origin/fork remotes already configured locally:
   `git fetch fork dev/cob812-auto-provision && git push origin FETCH_HEAD:refs/heads/dev/cob812-auto-provision`.)
2. Vercel builds the origin-repo branch preview automatically (no Git-App authorization step).
3. Alternative for the owner: merge PR #2 after the agent pushes the reviewed commits to the
   fork (agent-authorized path, already proven) — but the origin-branch preview route lets the
   browser acceptance run before any merge touches `main`.

The agent never handles or prints owner credentials; the push happens entirely under the
owner's own authenticated GitHub session.
