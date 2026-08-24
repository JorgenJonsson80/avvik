// deleteDays.js
// Admin-radering av hela dagar (VNR-rader, deras scans, rad-antal) för ett
// givet set datum. RLS (0004_secure_org_delete.sql) är den faktiska
// säkerhetsspärren — bara org-admins kan radera från deviations/rader/
// deviation_audit. Den här funktionen är bara klient-orkestreringen och
// kastar samma fel vidare som Postgres/RLS gör (t.ex. om anroparen inte
// är admin), så UI:t kan visa varför raderingen stoppades.
//
// Ordning spelar roll: deviation_audit har inget FK mot deviations (se
// 0001_init.sql), så den måste tömmas INNAN deviations raderas — annars blir
// dess rader föräldralösa istället för borttagna. scans har `on delete
// cascade` mot deviations och behöver inget eget anrop.
export async function deleteDays(supabase, dates) {
  if (!dates || dates.length === 0) return;

  const { data: rows, error: selErr } = await supabase
    .from("deviations")
    .select("id")
    .in("datum", dates);
  if (selErr) throw new Error(selErr.message);

  const devIds = (rows ?? []).map((r) => r.id);
  if (devIds.length > 0) {
    const { error: auditErr } = await supabase
      .from("deviation_audit")
      .delete()
      .in("deviation_id", devIds);
    if (auditErr) throw new Error(auditErr.message);
  }

  const { error: devErr } = await supabase
    .from("deviations")
    .delete()
    .in("datum", dates);
  if (devErr) throw new Error(devErr.message);

  const { error: raderErr } = await supabase
    .from("rader")
    .delete()
    .in("datum", dates);
  if (raderErr) throw new Error(raderErr.message);
}
