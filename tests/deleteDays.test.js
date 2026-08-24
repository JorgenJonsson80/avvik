import { describe, it, expect } from "vitest";
import { deleteDays } from "../src/lib/deleteDays.js";

// Minimal fake av supabase-js query builder — räcker för att verifiera
// ANROPSORDNINGEN (audit före deviations, deviations före rader) och att fel
// på ett steg stoppar resten, utan att dra in en riktig Postgres-anslutning.
function makeSupabase({ selectRows = [], selectError = null, deleteErrors = {} } = {}) {
  const calls = [];
  function builderFor(table) {
    let op = null;
    const builder = {
      select(cols) {
        op = "select";
        calls.push({ table, op, cols });
        return builder;
      },
      delete() {
        op = "delete";
        calls.push({ table, op });
        return builder;
      },
      in(col, vals) {
        calls.push({ table, op: `${op}.in`, col, vals });
        if (op === "select") {
          return Promise.resolve({ data: selectRows, error: selectError });
        }
        return Promise.resolve({ error: deleteErrors[table] ?? null });
      },
    };
    return builder;
  }
  return { calls, from: (table) => builderFor(table) };
}

describe("deleteDays", () => {
  it("tömmer audit innan deviations, och deviations innan rader", async () => {
    const supabase = makeSupabase({ selectRows: [{ id: "d1" }, { id: "d2" }] });
    await deleteDays(supabase, ["2026-05-01", "2026-05-02"]);

    const order = supabase.calls.map((c) => `${c.table}:${c.op}`);
    expect(order).toEqual([
      "deviations:select",
      "deviations:select.in",
      "deviation_audit:delete",
      "deviation_audit:delete.in",
      "deviations:delete",
      "deviations:delete.in",
      "rader:delete",
      "rader:delete.in",
    ]);

    const auditIn = supabase.calls.find((c) => c.op === "delete.in" && c.table === "deviation_audit");
    expect(auditIn.col).toBe("deviation_id");
    expect(auditIn.vals).toEqual(["d1", "d2"]);
  });

  it("hoppar över audit-radering om inga deviations matchar datumen", async () => {
    const supabase = makeSupabase({ selectRows: [] });
    await deleteDays(supabase, ["2026-05-01"]);

    expect(supabase.calls.some((c) => c.table === "deviation_audit")).toBe(false);
    expect(supabase.calls.some((c) => c.table === "deviations" && c.op === "delete")).toBe(true);
    expect(supabase.calls.some((c) => c.table === "rader" && c.op === "delete")).toBe(true);
  });

  it("gör inga anrop alls för en tom datumlista", async () => {
    const supabase = makeSupabase();
    await deleteDays(supabase, []);
    expect(supabase.calls).toEqual([]);
  });

  it("kastar och stoppar vid fel i select-steget", async () => {
    const supabase = makeSupabase({ selectError: { message: "boom" } });
    await expect(deleteDays(supabase, ["2026-05-01"])).rejects.toThrow("boom");
    expect(supabase.calls.some((c) => c.table === "deviations" && c.op === "delete")).toBe(false);
  });

  it("kastar och stoppar innan rader raderas om deviations-raderingen misslyckas", async () => {
    const supabase = makeSupabase({
      selectRows: [{ id: "d1" }],
      deleteErrors: { deviations: { message: "not authorized to delete deviations" } },
    });
    await expect(deleteDays(supabase, ["2026-05-01"])).rejects.toThrow("not authorized to delete deviations");
    expect(supabase.calls.some((c) => c.table === "rader")).toBe(false);
  });
});
