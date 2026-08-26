// restoreBackup.js
// Återställ deviations-tabellen från en backup-fils innehåll: upsertar
// backupens poster FÖRST, raderar sen bara det som blev över (poster som
// inte finns i backupen) — INTE radera-allt-sen-skriv-in. Om nätet dör mitt
// i en batch är upsert idempotent och säkert att köra om, så man står kvar
// med det mesta av datan intakt istället för hälften raderad och
// oåterställbar (retry på "insert" hade kraschat på dubblettnyckel för de
// batchar som redan lyckats).
import { cleanDeviationRow } from "./importParser.js";

const BATCH = 500;

async function batchWrite(supabase, table, rows, opts) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const q = opts?.onConflict
      ? supabase.from(table).upsert(chunk, { onConflict: opts.onConflict })
      : supabase.from(table).insert(chunk);
    const { error } = await q;
    if (error) throw new Error(`Batch ${Math.floor(i / BATCH) + 1}: ${error.message}`);
  }
}

export async function restoreFromBackup(supabase, { backupRecords, existingDeviations, uid }) {
  const rows = backupRecords.map((r) => cleanDeviationRow({ ...r, user_id: uid }));
  await batchWrite(supabase, "deviations", rows, { onConflict: "org_id,datum,vnr" });

  const backupKeys = new Set(backupRecords.map((r) => `${String(r.datum).slice(0, 10)}|${r.vnr}`));
  const staleIds = existingDeviations
    .filter((d) => !backupKeys.has(`${String(d.datum).slice(0, 10)}|${d.vnr}`))
    .map((d) => d.id);

  for (let i = 0; i < staleIds.length; i += BATCH) {
    const chunk = staleIds.slice(i, i + BATCH);
    const { error } = await supabase.from("deviations").delete().in("id", chunk);
    if (error) throw new Error(`Kunde inte ta bort gamla poster som saknas i backupen: ${error.message}`);
  }

  return { restoredCount: backupRecords.length, removedCount: staleIds.length };
}
