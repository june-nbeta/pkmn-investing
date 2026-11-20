"use server";

import { Pool } from "@neondatabase/serverless";
import { getSession } from "@/lib/session";
import { provisionNewCollection, AlreadyProvisionedError } from "@/lib/provisioning";

/**
 * New-user collection provisioning action (COB-812 milestone).
 *
 * Exposes the fresh-collection path for brand-new accounts: a signed-in Better
 * Auth user with no bound legacy `users` row may create their own empty
 * collection identity. Legacy rows remain reachable ONLY through the explicit
 * claim flow with an operator-issued token — this action never touches an
 * existing users row.
 */
export async function provisionMyCollection(): Promise<{ ok: boolean; message: string }> {
  const session = await getSession();
  if (!session) {
    return { ok: false, message: "Sign in first, then create your collection." };
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userId = await provisionNewCollection(
      client,
      session.user.id,
      session.user.email ?? null,
    );
    await client.query("COMMIT");
    return { ok: true, message: `Collection created (identity ${userId}). You can import now.` };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error instanceof AlreadyProvisionedError) {
      return { ok: true, message: error.message };
    }
    return { ok: false, message: "Provisioning failed. Try again." };
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}
