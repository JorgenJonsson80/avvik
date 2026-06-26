import { useState } from "react";
import { useDeviations } from "../hooks/useDeviations.js";
import { useRader } from "../hooks/useRader.js";
import { supabase } from "../lib/supabase.js";
import { readX08File, readRaderFile, readBackupFile, mergeDeviations, cleanDeviationRow } from "../lib/importParser.js";
import { OrsaksSelect } from "./shared/OrsaksSelect.jsx";
import { ORSAK_ANSVAR } from "../lib/causes.js";
import { formatMinBefore } from "../lib/routes.js";

const ZON_BG = { "1": "#4ade80", "2": "#60a5fa", "3": "#f97316", "?": "#6b7280" };

export function ImportTab() {
  const { deviations, refetch } = useDeviations();
  const { upsertRader }         = useRader();

  const [groups,        setGroups]        = useState([]);
  const [importing,     setImporting]     = useState(false);
  const [datum,         setDatum]         = useState("");
  const [saved,         setSaved]         = useState(false);
  const [mergeInfo,     setMergeInfo]     = useState(null);
  const [raderInfo,     setRaderInfo]     = useState(null);
  const [saveError,     setSaveError]     = useState(null);
  const [saving,        setSaving]        = useState(false);
  const [backupStatus,  setBackupStatus]  = useState(null); // { ok, msg }
  const [backupLoading, setBackupLoading] = useState(false);

  // Inline orsak/kommentar-state för nya poster (id = vnr, eftersom datum är fixerat)
  const [localOrsak,      setLocalOrsak]      = useState({});
  const [localKommentar,  setLocalKommentar]  = useState({});

  function orsakFor(g)     { return localOrsak[g.vnr]     !== undefined ? localOrsak[g.vnr]     : g.orsak     || ""; }
  function kommentarFor(g) { return localKommentar[g.vnr] !== undefined ? localKommentar[g.vnr] : g.kommentar || ""; }

  async function handleX08(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true); setSaved(false); setSaveError(null); setGroups([]);
    try {
      const { records, datum: detDatum, error } = await readX08File(file);
      if (error) { setSaveError(error); return; }
      const useDatum = detDatum || datum;
      if (useDatum && !datum) setDatum(useDatum);
      const existing = deviations.filter((d) => d.datum === (useDatum || datum));
      const merged   = mergeDeviations(existing, records.map((r) => ({ ...r, datum: useDatum || datum })));
      merged.sort((a, b) => (a.first_time || "99:99").localeCompare(b.first_time || "99:99"));
      setGroups(merged);
      const updated = merged.filter((g) => g.alreadyExists).length;
      const added   = merged.filter((g) => !g.alreadyExists).length;
      setMergeInfo({ updated, added });
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  }

  async function handleRader(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    try {
      const { rader, datum: detDatum, error } = await readRaderFile(file);
      if (error) { setSaveError(error); return; }
      const useDatum = detDatum || datum;
      if (useDatum && !datum) setDatum(useDatum);
      await upsertRader({ datum: useDatum, ...rader });
      const total = rader.zon1 + rader.zon2 + rader.zon3;
      setRaderInfo({ datum: useDatum, total, ...rader });
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  }

  async function handleSave() {
    if (!datum || groups.length === 0) return;
    setSaving(true); setSaveError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const uid = user.id;

      // Bygg deviations-rader (utan events-fältet som inte finns i tabellen)
      const rows = groups.map((g) => {
        const { events, alreadyExists, first_time, routes, ships, ...rest } = g;
        return {
          ...rest,
          datum,
          user_id:  uid,
          orsak:    orsakFor(g)     || rest.orsak     || "",
          kommentar: kommentarFor(g) || rest.kommentar || "",
        };
      });

      const { data: upserted, error: devErr } = await supabase
        .from("deviations")
        .upsert(rows, { onConflict: "user_id,datum,vnr" })
        .select("id, vnr");
      if (devErr) throw new Error(devErr.message);

      // Bygg scans-rader för nya poster (alreadyExists = false)
      const devByVnr = new Map((upserted ?? []).map((d) => [d.vnr, d.id]));
      const scanRows = [];
      for (const g of groups) {
        if (!g.events?.length) continue;
        const devId = devByVnr.get(g.vnr);
        if (!devId) continue;
        // Ta bort befintliga scans för denna deviation (vid re-import)
        await supabase.from("scans").delete().eq("deviation_id", devId);
        const devOrsak = orsakFor(g) || g.orsak || "";
        for (const ev of g.events) {
          scanRows.push({
            user_id:        uid,
            deviation_id:   devId,
            tid:            ev.tid,
            location:       ev.location,
            route_code:     ev.route_code,
            ship_to:        ev.ship_to,
            avgangstid:     ev.avgangstid,
            nasta_dag:      ev.nasta_dag,
            min_fore_avgang: ev.min_fore_avgang,
            in_kontroll:    ev.in_kontroll,
            orsak:          devOrsak, // default = VNR-dagens orsak, aldrig från inKontroll
          });
        }
      }
      if (scanRows.length > 0) {
        const { error: scanErr } = await supabase.from("scans").insert(scanRows);
        if (scanErr) throw new Error(scanErr.message);
      }

      setSaved(true);
      await refetch();
      setGroups([]);
      setMergeInfo(null);
      setLocalOrsak({});
      setLocalKommentar({});
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleBackup(e, mode) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";

    if (mode === "återställ") {
      if (!window.confirm(`Återställ från backup? ALL befintlig data (avvikelser, scanningar) raderas och ersätts med filens innehåll.`)) return;
    }

    setBackupLoading(true);
    setBackupStatus(null);
    try {
      const { records, error } = await readBackupFile(file);
      if (error) { setBackupStatus({ ok: false, msg: error }); return; }

      const { data: { user } } = await supabase.auth.getUser();
      const uid = user.id;

      // Supabase API:s rad-limit kräver batchning för stora importer
      const BATCH = 500;
      const batchWrite = async (rows, opts) => {
        for (let i = 0; i < rows.length; i += BATCH) {
          const chunk = rows.slice(i, i + BATCH);
          const q = opts?.onConflict
            ? supabase.from("deviations").upsert(chunk, { onConflict: opts.onConflict })
            : supabase.from("deviations").insert(chunk);
          const { error } = await q;
          if (error) throw new Error(`Batch ${Math.floor(i / BATCH) + 1}: ${error.message}`);
        }
      };

      if (mode === "återställ") {
        await supabase.from("deviations").delete().neq("id", "00000000-0000-0000-0000-000000000000");
        const rows = records.map((r) => cleanDeviationRow({ ...r, user_id: uid }));
        await batchWrite(rows);
        setBackupStatus({ ok: true, msg: `Återställt ${records.length} poster från backup.` });
      } else {
        // "lägg till" — upsert med merge: bevara befintlig orsak om meningsfull
        const existing = deviations;
        const byKey    = new Map(existing.map((r) => [`${r.datum}|${r.vnr}`, r]));
        const rows = records.map((r) => {
          const prev = byKey.get(`${r.datum}|${r.vnr}`);
          const keepOrsak = prev?.orsak && prev.orsak !== "Okänd";
          return cleanDeviationRow({
            ...r,
            user_id:   uid,
            id:        prev?.id,
            orsak:     keepOrsak ? prev.orsak : (r.orsak || ""),
            kommentar: prev?.kommentar        || r.kommentar || "",
          }, { keepId: true });
        });
        await batchWrite(rows, { onConflict: "user_id,datum,vnr" });
        const nytt = records.filter((r) => !byKey.has(`${r.datum}|${r.vnr}`)).length;
        const upd  = records.length - nytt;
        setBackupStatus({ ok: true, msg: `Lade till ${nytt} nya poster, uppdaterade ${upd} befintliga.` });
      }
      await refetch();
    } catch (err) {
      setBackupStatus({ ok: false, msg: err.message });
    } finally {
      setBackupLoading(false);
    }
  }

  const newGroups      = groups.filter((g) => !g.alreadyExists);
  const allNewHaveOrsak = newGroups.every((g) => orsakFor(g));
  const mixedWarn      = groups.filter((g) => g.kontroll_scans > 0 && g.kontroll_total > 0
    && g.kontroll_scans < g.kontroll_total);
  const donePct = newGroups.length === 0 ? 100
    : Math.round(newGroups.filter((g) => orsakFor(g)).length / newGroups.length * 100);

  return (
    <div style={s.wrap}>
      {/* Toolbar */}
      <div style={s.toolbar}>
        <label style={s.btn}>
          {importing ? "Läser…" : "📂 Ladda avvikelsefil"}
          <input type="file" accept=".xlsx,.xls,.csv" onChange={handleX08} style={{ display: "none" }} />
        </label>
        <label style={{ ...s.btn, background: "#13131c", color: "#60a5fa", border: "1px solid #1a3a4a" }}>
          📊 Ladda rader-fil
          <input type="file" accept=".xlsx,.xls" onChange={handleRader} style={{ display: "none" }} />
        </label>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          <label style={s.dimLabel}>Datum:</label>
          <input
            type="date"
            value={datum}
            onChange={(e) => setDatum(e.target.value)}
            style={s.dateInput}
          />
        </div>

        {/* Progress-indikator */}
        {newGroups.length > 0 && (
          <div style={{ fontSize: 11, color: "#888", textAlign: "right" }}>
            {newGroups.filter((g) => orsakFor(g)).length}/{newGroups.length} orsaker satta
            <div style={s.progressBg}>
              <div style={{ ...s.progressFill, width: `${donePct}%` }} />
            </div>
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saved || !datum || groups.length === 0 || saving}
          style={{
            ...s.saveBtn,
            background: saved ? "#2a2a3a" : !datum || groups.length === 0 ? "#2a2a3a"
              : allNewHaveOrsak ? "#7c6af7" : "#4ade80",
            color: saved || !datum || groups.length === 0 ? "#555" : "#0a0a0f",
            cursor: saved || !datum || groups.length === 0 ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "Sparar…"
            : saved ? "✓ Sparat"
            : !datum ? "Ange datum först"
            : groups.length === 0 ? "Ladda fil först"
            : allNewHaveOrsak ? "Spara alla"
            : `Spara (${newGroups.filter((g) => !orsakFor(g)).length} saknar orsak)`}
        </button>
      </div>

      {/* Fel */}
      {saveError && <div style={s.error}>⚠ {saveError}</div>}

      {/* Rader-bekräftelse */}
      {raderInfo && (
        <div style={s.raderInfo}>
          ✓ Sparade rader för <strong>{raderInfo.datum}</strong>: totalt{" "}
          <strong>{raderInfo.total.toLocaleString("sv-SE")}</strong> rader
          {" "}(Z1: {raderInfo.zon1.toLocaleString("sv-SE")} · Z2: {raderInfo.zon2.toLocaleString("sv-SE")} · Z3: {raderInfo.zon3.toLocaleString("sv-SE")})
        </div>
      )}

      {/* Merge-info */}
      {mergeInfo && (
        <div style={s.mergeInfo}>
          <span>✓ <strong style={{ color: "#4ade80" }}>{mergeInfo.updated}</strong> VNR uppdaterade (orsak behållen)</span>
          <span>＋ <strong style={{ color: "#7c6af7" }}>{mergeInfo.added}</strong> nya VNR att bedöma</span>
        </div>
      )}

      {/* Kontroll-varning */}
      {mixedWarn.length > 0 && (
        <div style={s.kontrollWarn}>
          <div style={{ marginBottom: 4 }}>
            ⚠ <strong>{mixedWarn.length} VNR</strong> har scans både i kontrollkedja OCH utanför — granska orsaken:
          </div>
          <div style={{ color: "#c08ab0", lineHeight: 1.6 }}>
            {mixedWarn.map((g) => `${g.vnr} (${g.kontroll_scans}/${g.kontroll_total} i kedja)`).join(" · ")}
          </div>
        </div>
      )}

      {/* Ny-poster lista */}
      {newGroups.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={s.sectionHeader}>Nya poster att bedöma ({newGroups.length})</div>
          <div style={s.rowList}>
            {newGroups.map((g) => (
              <div key={g.vnr} style={s.devRow}>
                <div style={s.devGrid}>
                  <span style={s.vnr}>
                    {g.vnr}
                    {g.locations?.[0] && <span style={s.loc}> {g.locations[0]}</span>}
                    {g.kbana && <span style={s.kbana}> {g.kbana}</span>}
                    {g.first_time && <span style={s.times}> 🕐 {g.first_time}</span>}
                    {g.route_code && (
                      <span style={s.routeMeta}>
                        {" "}Tur {g.route_code}
                        {g.avgangstid && <span style={s.avg}> · avg {g.avgangstid}</span>}
                        {g.min_fore_avgang != null && (
                          <span style={{ color: g.min_fore_avgang < 60 ? "#f87171" : "#4ade80", fontWeight: 700 }}>
                            {" "}· {formatMinBefore(g.min_fore_avgang, g.nasta_dag)}
                          </span>
                        )}
                      </span>
                    )}
                    {g.kontroll_scans > 0 && (
                      <span style={{ color: "#e879c5", fontSize: 10, marginLeft: 8 }}>
                        {g.kontroll_scans}/{g.kontroll_total} i kedja
                      </span>
                    )}
                  </span>
                  <span style={{ ...s.countBadge, color: g.count >= 10 ? "#f97316" : "#f0f0f5" }}>×{g.count}</span>
                  <span style={{ ...s.zonBadge, background: ZON_BG[g.zon] }}>Z{g.zon || "?"}</span>
                </div>
                <div style={s.editRow}>
                  <OrsaksSelect
                    value={orsakFor(g)}
                    onChange={(v) => setLocalOrsak((p) => ({ ...p, [g.vnr]: v }))}
                  />
                  <input
                    placeholder="Kommentar…"
                    value={kommentarFor(g)}
                    onChange={(e) => setLocalKommentar((p) => ({ ...p, [g.vnr]: e.target.value }))}
                    style={s.kommentarInput}
                  />
                  {ORSAK_ANSVAR[orsakFor(g)] && ORSAK_ANSVAR[orsakFor(g)] !== "—" && (
                    <span style={s.ansvar}>→ {ORSAK_ANSVAR[orsakFor(g)]}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Befintliga (uppdaterade) poster — kollapsad vy */}
      {groups.filter((g) => g.alreadyExists).length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={s.sectionHeader}>
            Befintliga poster (orsak bevarad) — {groups.filter((g) => g.alreadyExists).length} st
          </div>
          <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>
            {groups.filter((g) => g.alreadyExists).map((g) => g.vnr).join(" · ")}
          </div>
        </div>
      )}

      {groups.length === 0 && !saved && (
        <div style={s.empty}>
          Ladda en X08-avvikelsefil (xlsx) för att komma igång.
        </div>
      )}
      {saved && (
        <div style={s.savedMsg}>
          ✓ Sparat! Öppna Historik-fliken för att se och redigera avvikelserna.
        </div>
      )}

      {/* ── Backup-import ─────────────────────────────────────── */}
      <div style={s.backupSection}>
        <div style={s.sectionHeader}>Importera från backup-Excel</div>
        <div style={{ fontSize: 12, color: "#555", marginBottom: 10 }}>
          Ladda en fil som exporterats från Historik → Exportera Excel.
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <label style={{ ...s.btn, background: "#0d1a0d", color: "#4ade80", border: "1px solid #1a3a1a", opacity: backupLoading ? 0.5 : 1 }}>
            {backupLoading ? "Läser…" : "Lägg till från backup"}
            <input type="file" accept=".xlsx,.xls" onChange={(e) => handleBackup(e, "lägg till")} style={{ display: "none" }} disabled={backupLoading} />
          </label>
          <label style={{ ...s.btn, background: "#1a0d0d", color: "#f87171", border: "1px solid #3a1515", opacity: backupLoading ? 0.5 : 1 }}>
            {backupLoading ? "Läser…" : "Återställ från backup"}
            <input type="file" accept=".xlsx,.xls" onChange={(e) => handleBackup(e, "återställ")} style={{ display: "none" }} disabled={backupLoading} />
          </label>
        </div>
        {backupStatus && (
          <div style={{ marginTop: 10, fontSize: 13, color: backupStatus.ok ? "#4ade80" : "#f87171" }}>
            {backupStatus.ok ? "✓ " : "⚠ "}{backupStatus.msg}
          </div>
        )}
      </div>
    </div>
  );
}

const s = {
  wrap:         { padding: "16px 20px", fontFamily: "system-ui, sans-serif", background: "#0a0a0f", minHeight: "100%", color: "#f0f0f5" },
  toolbar:      { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 16 },
  btn:          { background: "#16162a", border: "1px solid #2a2a3a", color: "#7c6af7", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  dimLabel:     { fontSize: 12, color: "#888" },
  dateInput:    { background: "#13131c", border: "1px solid #2a2a3a", color: "#f0f0f5", borderRadius: 6, padding: "6px 10px", fontSize: 13, outline: "none" },
  progressBg:   { width: 100, height: 4, background: "#2a2a3a", borderRadius: 2, marginTop: 4 },
  progressFill: { height: "100%", background: "#7c6af7", borderRadius: 2, transition: "width .3s" },
  saveBtn:      { borderRadius: 8, padding: "10px 24px", fontWeight: 700, fontSize: 13, border: "none", letterSpacing: 0.5, whiteSpace: "nowrap", fontFamily: "inherit" },
  error:        { background: "#1a0808", border: "1px solid #4a1515", borderRadius: 8, padding: "10px 16px", fontSize: 12, color: "#f87171", marginBottom: 12 },
  raderInfo:    { background: "#0d1520", border: "1px solid #1a3a4a", borderRadius: 8, padding: "10px 16px", marginBottom: 12, fontSize: 12, color: "#60a5fa" },
  mergeInfo:    { background: "#13131c", border: "1px solid #2a2a3a", borderRadius: 8, padding: "10px 16px", marginBottom: 12, fontSize: 12, color: "#888", display: "flex", gap: 24, flexWrap: "wrap" },
  kontrollWarn: { background: "#1a0d18", border: "1px solid #6a2a5a", borderRadius: 8, padding: "10px 16px", marginBottom: 12, fontSize: 12, color: "#e879c5" },
  sectionHeader:{ fontSize: 11, color: "#7c6af7", fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 },
  rowList:      { display: "flex", flexDirection: "column", gap: 6 },
  devRow:       { background: "#13131c", border: "1px solid #1e1e2e", borderRadius: 6, padding: "10px 12px" },
  devGrid:      { display: "grid", gridTemplateColumns: "1fr 56px 44px", gap: 8, alignItems: "center", marginBottom: 8 },
  vnr:          { fontFamily: "monospace", color: "#f0f0f5", fontSize: 12 },
  loc:          { color: "#8a8a9a", fontSize: 11 },
  kbana:        { color: "#f97316", fontWeight: 700, fontSize: 10 },
  times:        { color: "#7c6af7", fontSize: 10 },
  routeMeta:    { color: "#666", fontSize: 10 },
  avg:          { color: "#60a5fa" },
  countBadge:   { textAlign: "center", fontFamily: "monospace", fontWeight: 700, fontSize: 13 },
  zonBadge:     { color: "#0a0a0f", borderRadius: 4, padding: "2px 6px", fontSize: 11, fontWeight: 700, fontFamily: "monospace", textAlign: "center" },
  editRow:      { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  kommentarInput: { flex: 1, minWidth: 160, background: "#0f0f18", border: "1px solid #2a2a3a", color: "#f0f0f5", borderRadius: 6, padding: "5px 10px", fontSize: 12, outline: "none", fontFamily: "inherit" },
  ansvar:       { fontSize: 11, color: "#60a5fa", whiteSpace: "nowrap" },
  empty:         { textAlign: "center", color: "#555", paddingTop: 60, fontSize: 14 },
  savedMsg:      { textAlign: "center", color: "#4ade80", paddingTop: 60, fontSize: 15 },
  backupSection: { marginTop: 40, borderTop: "1px solid #1e1e2e", paddingTop: 20 },
};
