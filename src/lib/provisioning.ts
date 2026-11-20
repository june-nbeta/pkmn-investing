import type { PoolClient } from "@neondatabase/serverless";

/**
 * New-user collection provisioning (COB-812 milestone: normal signup → own collection).
 *
 * Contract:
 * - A signed-in Better Auth user with NO bound legacy `users` row may provision a
 *   fresh, empty collection identity (a new `users` row bound via better_auth_user_id).
 * - This NEVER touches an existing users row: a user who is already bound cannot
 *   provision again, and this path can never adopt/rebind a legacy collection.
 *   Binding to a PRE-EXISTING users row remains the exclusive job of the explicit
 *   claim flow (src/app/(auth)/claim), which requires an operator-issued token.
 * - Legacy owner-claim security rules, import protections, and test evidence are
 *   unchanged: getOwnerUserId still throws OwnershipNotClaimedError for unbound
 *   sessions, so import access still requires an explicit binding — this module
 *   just provides the legitimate way for a brand-new user to create that binding.
 */
export class AlreadyProvisionedError extends Error {
  constructor() {
    super("This account already has a collection identity. No new collection is needed.");
    this.name = "AlreadyProvisionedError";
  }
}

export async function provisionNewCollection(
  client: Pick<PoolClient, "query">,
  betterAuthUserId: string,
  email?: string | null,
): Promise<number> {
  if (!betterAuthUserId) throw new Error("A signed-in Better Auth user id is required.");

  // Idempotence guard inside the caller's transaction: never double-provision.
  const existing = await client.query<{ id: number }>(
    "SELECT id FROM users WHERE better_auth_user_id = $1",
    [betterAuthUserId],
  );
  if (existing.rows.length > 0) throw new AlreadyProvisionedError();

  const inserted = await client.query<{ id: number }>(
    "INSERT INTO users (better_auth_user_id, email) VALUES ($1, $2) RETURNING id",
    [betterAuthUserId, email ?? null],
  );
  return inserted.rows[0].id;
}
