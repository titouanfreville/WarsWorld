import { describe, expect, it } from "vitest";
import { stripPassword } from "server/prisma/password-guard";

/**
 * The hash must never leave the server. `stripPassword` is the runtime half of that guarantee —
 * the Prisma extension runs it over every `User` read that didn't explicitly select the password.
 */
describe("password guard", () => {
  it("drops the hash from a single row, keeping every other field", () => {
    expect(
      stripPassword({
        id: "u1",
        name: "titouan",
        email: "t@example.com",
        password: "$2b$12$abcdefghijklmnopqrstuv",
        roles: ["admin"],
      }),
    ).toEqual({ id: "u1", name: "titouan", email: "t@example.com", roles: ["admin"] });
  });

  it("drops the hash from every row of a list", () => {
    const rows = stripPassword([
      { id: "u1", password: "hash-1" },
      { id: "u2", password: "hash-2" },
    ]);

    expect(rows).toEqual([{ id: "u1" }, { id: "u2" }]);
    expect(JSON.stringify(rows)).not.toContain("hash");
  });

  it("leaves a row that never carried a password untouched", () => {
    const row = { id: "u1", name: "titouan" };

    expect(stripPassword(row)).toEqual(row);
  });

  it("passes non-row results through — count and aggregate return plain values", () => {
    expect(stripPassword(7)).toBe(7);
    expect(stripPassword(null)).toBeNull();
    expect(stripPassword({ _count: { id: 3 } })).toEqual({ _count: { id: 3 } });
  });

  it("removes the key entirely rather than blanking it, so no field hints at a hash", () => {
    expect("password" in (stripPassword({ id: "u1", password: "x" }) as object)).toBe(false);
  });
});
