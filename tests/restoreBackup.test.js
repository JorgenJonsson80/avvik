import { describe, it, expect } from "vitest";
import { restoreFromBackup } from "../src/lib/restoreBackup.js";

// Minimal fake av supabase-js query builder — räcker för att verifiera att
// UPSERT alltid sker innan DELETE, och att ett fel i upsert-steget stoppar
// raderingen (så en avbruten återställning aldrig kan lämna befintlig data
// halvraderad utan att backupens poster hann skrivas in).
function makeSupabase({ upsertError = null, deleteError = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        upsert(rows) {
          calls.push({ table, op: "upsert", rows });
          return Promise.resolve({ error: upsertError });
        },
        delete() {
          calls.push({ table, op: "delete" });
          return {
            in(col, vals) {
              calls.push({ table, op: "delete.in", col, vals });
              return Promise.resolve({ error: deleteError });
            },
          };
        },
      };
    },
  };
}

const existing = [
  { id: "d1", datum: "2026-05-01", vnr: "111" },
  { id: "d2", datum: "2026-05-01", vnr: "222" },
  { id: "d3", datum: "2026-05-02", vnr: "333" },
];

describe("restoreFromBackup", () => {
  it("upsertar innan den raderar det som saknas i backupen", async () => {
    const supabase = makeSupabase();
    const backupRecords = [{ datum: "2026-05-01", vnr: "111" }];

    await restoreFromBackup(supabase, { backupRecords, existingDeviations: existing, uid: "u1" });

    const order = supabase.calls.map((c) => c.op);
    expect(order).toEqual(["upsert", "delete", "delete.in"]);
  });

  it("raderar bara poster som saknas i backupen, resten lämnas orörda", async () => {
    const supabase = makeSupabase();
    const backupRecords = [{ datum: "2026-05-01", vnr: "111" }];

    const { restoredCount, removedCount } = await restoreFromBackup(supabase, {
      backupRecords, existingDeviations: existing, uid: "u1",
    });

    expect(restoredCount).toBe(1);
    expect(removedCount).toBe(2);
    const del = supabase.calls.find((c) => c.op === "delete.in");
    expect(del.vals.sort()).toEqual(["d2", "d3"]);
  });

  it("raderar inget om backupen täcker all befintlig data", async () => {
    const supabase = makeSupabase();
    const backupRecords = existing.map(({ datum, vnr }) => ({ datum, vnr }));

    const { removedCount } = await restoreFromBackup(supabase, {
      backupRecords, existingDeviations: existing, uid: "u1",
    });

    expect(removedCount).toBe(0);
    expect(supabase.calls.some((c) => c.op === "delete")).toBe(false);
  });

  it("kastar och radera-steget körs aldrig om upsert misslyckas", async () => {
    const supabase = makeSupabase({ upsertError: { message: "network down" } });
    const backupRecords = [{ datum: "2026-05-01", vnr: "111" }];

    await expect(
      restoreFromBackup(supabase, { backupRecords, existingDeviations: existing, uid: "u1" })
    ).rejects.toThrow("network down");
    expect(supabase.calls.some((c) => c.op === "delete")).toBe(false);
  });

  it("normaliserar datumsträngar (t.ex. med tidszon-suffix) vid nyckeljämförelse", async () => {
    const supabase = makeSupabase();
    const existingWithTz = [{ id: "d1", datum: "2026-05-01T00:00:00+00:00", vnr: "111" }];
    const backupRecords = [{ datum: "2026-05-01", vnr: "111" }];

    const { removedCount } = await restoreFromBackup(supabase, {
      backupRecords, existingDeviations: existingWithTz, uid: "u1",
    });

    expect(removedCount).toBe(0);
  });
});
