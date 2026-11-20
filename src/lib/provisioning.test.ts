import { describe, it, expect, vi } from "vitest";
import { provisionNewCollection, AlreadyProvisionedError } from "./provisioning";

/**
 * Unit tests for new-user collection provisioning (COB-812 milestone).
 * These verify the pure logic contract against a mocked PoolClient — no
 * database connection is made, honoring the read-only/no-writes constraint.
 */

function makeClient(initialRows: Array<{ id: number }> = []) {
  let inserted = false;
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("SELECT id FROM users WHERE better_auth_user_id")) {
        return { rows: initialRows };
      }
      if (sql.startsWith("INSERT INTO users")) {
        inserted = true;
        return { rows: [{ id: 42 }] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }),
    _inserted: () => inserted,
  } as any;
}

describe("provisionNewCollection", () => {
  it("inserts a fresh users row bound to the Better Auth user id", async () => {
    const client = makeClient([]); // no existing binding
    const id = await provisionNewCollection(client, "ba-user-1", "jason@test.local");
    expect(id).toBe(42);
    expect(client.query).toHaveBeenCalledWith(
      "INSERT INTO users (better_auth_user_id, email) VALUES ($1, $2) RETURNING id",
      ["ba-user-1", "jason@test.local"],
    );
    expect(client._inserted()).toBe(true);
  });

  it("throws AlreadyProvisionedError when a binding already exists", async () => {
    const client = makeClient([{ id: 7 }]);
    await expect(provisionNewCollection(client, "ba-user-1")).rejects.toBeInstanceOf(
      AlreadyProvisionedError,
    );
    // Must never attempt an INSERT when a binding exists.
    expect(client._inserted()).toBe(false);
  });

  it("never modifies an existing users row (legacy claim exclusivity preserved)", async () => {
    const client = makeClient([{ id: 7 }]);
    await expect(provisionNewCollection(client, "ba-legacy-owner")).rejects.toThrow(
      /already has a collection identity/,
    );
    const sqls = client.query.mock.calls.map((c: any) => c[0] as string);
    expect(sqls.every((s: string) => !s.includes("UPDATE"))).toBe(true);
  });

  it("inserts with null email when none is provided", async () => {
    const client = makeClient([]);
    await provisionNewCollection(client, "ba-user-2");
    expect(client.query).toHaveBeenCalledWith(
      "INSERT INTO users (better_auth_user_id, email) VALUES ($1, $2) RETURNING id",
      ["ba-user-2", null],
    );
  });

  it("rejects an empty Better Auth user id outright", async () => {
    const client = makeClient([]);
    await expect(provisionNewCollection(client, "")).rejects.toThrow(
      /signed-in Better Auth user id is required/,
    );
    expect(client._inserted()).toBe(false);
  });
});
