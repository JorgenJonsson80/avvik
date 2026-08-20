import { useState, useRef } from "react";
import { useDeviations } from "../hooks/useDeviations.js";
import { useRader } from "../hooks/useRader.js";
import { useOrgRole } from "../hooks/useOrgRole.js";
import { supabase } from "../lib/supabase.js";
import {
  detectFileType,
  readX08File, readRaderFile, readBackupFile,
  mergeDeviations, cleanDeviationRow,
} from "../lib/importParser.js";
import { OrsaksSelect } from "./shared/OrsaksSelect.jsx";
import { ORSAK_ANSVAR } from "../lib/causes.js";
import { formatMinBefore } from "../lib/routes.js";

const ZON_BG = { "1": "#4ade80", "2": "#60a5fa", "3": "#f97316", "Loax": "#a78bfa", "KG kyl": "#67e8f9", "?": "#6b7280" };

export function ImportTab() {
  const { deviations, refetch } = useDeviations();
  const { upsertRader }         = useRader();
  const { isAdmin }             = useOrgRole();
  const fileInputRef            = useRef(null);

  const [dragOver,      setDragOver]      = useState(false);
  const [loading,       setLoading]       = useState(false);
  const [loadedType,    setLoadedType]    = useState(null); // 'x08' | 'rader' | 'backup'
  const [fileName,      setFileName]      = useState("");

  // X08-state
  const [groups,        setGroups]        = useState([]);
  const [datum,         setDatum]         = useState("");
  const [needsDatum,    setNeedsDatum]    = useState(false);
  const [saving,        setSaving]        = useState(false);
  const [saved,         setSaved]         = useState(false);
  const [mergeInfo,     setMergeInfo]     = useState(null);
  const [localOrsak,    setLocalOrsak]    = useState({});
  const [localKommentar,setLocalKommentar]= useState({});

  // Rader-state
  const [raderInfo,     setRaderInfo]     = useState(null);

  // Backup-state
  const [backupRecords, setBackupRecords] = useState(null);
  const [backupSaving,  setBackupSaving]  = useState(false);
  const [backupStatus,  setBackupStatus]  = useState(null);

  // Gemensamt felmeddelande
  const [error,         setError]         = useState(null);

  function orsakFor(g)     { return localOrsak[g.vnr]      !== undefined ? localOrsak[g.vnr]      : g.orsak      || ""; }
  function kommentarFor(g) { return localKommentar[g.vnr]  !== undefined ? localKommentar[g.vnr]  : g.kommentar  || ""; }

  // ── Huvud-handler: en fil in, auto-detektera ──────────────────────────────
  async function handleFile(file) {
    if (!file) return;
    setLoading(true);
    setError(null);
    setSaved(false);
    setGroups([]);
    setRaderInfo(null);
    setBackupRecords(null);
    setBackupStatus(null);
    setMergeInfo(null);
    setLoadedType(null);
    setFileName(file.name);

    try {
      const type = await detectFileType(file);
      setLoadedType(type);

      if (type === "rader") {
        const { rader, datum: detDatum, error: err } = await readRaderFile(file);
        if (err) { setError(`Rader-filen kunde inte läsas: ${err}`); return; }
        const useDatum = (detDatum || datum || "").slice(0, 10);
        if (!useDatum) { setNeedsDatum(true); setError("Ange datum nedan — det hittades inte automatiskt i filen."); return; }
        setDatum(useDatum);
        await upsertRader({ datum: useDatum, ...rader });
        setRaderInfo({ datum: useDatum, total: rader.zon1 + rader.zon2 + rader.zon3, ...rader });

      } else if (type === "backup") {
        const { records, error: err } = await readBackupFile(file);
        if (err) { setError(`Backup-filen kunde inte läsas: ${err}`); return; }
        setBackupRecords(records);

      } else { // x08
        const { records, datum: detDatum, error: err } = await readX08File(file);
        if (err) { setError(`Filen kunde inte läsas: ${err}`); return; }
        const useDatum = (detDatum || datum || "").slice(0, 10);
        if (!useDatum) { setNeedsDatum(true); setError("Ange datum nedan — det hittades inte automatiskt i filen."); return; }
        setNeedsDatum(false);
        if (!datum) setDatum(useDatum);
        const existing = deviations.filter((d) => d.datum === useDatum);
        const merged   = mergeDeviations(existing, records.map((r) => ({ ...r, datum: useDatum })));
        merged.sort((a, b) => (a.first_time || "99:99").localeCompare(b.first_time || "99:99"));
        setGroups(merged);
        setMergeInfo({
          updated: merged.filter((g) => g.alreadyExists).length,
          added:   merged.filter((g) => !g.alreadyExists).length,
        });
      }
    } catch (e) {
      setError(`Något gick fel: ${e.message}`);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // ── Spara X08 ────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!datum || groups.length === 0) return;
    setSaving(true); setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const uid = user.id;
      const rows = groups.map((g) => {
        const { events, alreadyExists, first_time, routes, ships, ...rest } = g;
        return { ...rest, datum, user_id: uid, orsak: orsakFor(g) || rest.orsak || "", kommentar: kommentarFor(g) || rest.kommentar || "" };
      });
      const { data: upserted, error: devErr } = await supabase
        .from("deviations").upsert(rows, { onConflict: "org_id,datum,vnr" }).select("id, vnr");
      if (devErr) throw new Error(devErr.message);

      const devByVnr = new Map((upserted ?? []).map((d) => [d.vnr, d.id]));
      const scanRows = [];
      const devIdsToClear = [];
      for (const g of groups) {
        if (!g.events?.length) continue;
        const devId = devByVnr.get(g.vnr);
        if (!devId) continue;
        devIdsToClear.push(devId);
        const devOrsak = orsakFor(g) || g.orsak || "";
        for (const ev of g.events) {
          scanRows.push({ user_id: uid, deviation_id: devId, tid: ev.tid, location: ev.location,
            route_code: ev.route_code, ship_to: ev.ship_to, avgangstid: ev.avgangstid,
            nasta_dag: ev.nasta_dag, min_fore_avgang: ev.min_fore_avgang,
            in_kontroll: ev.in_kontroll, orsak: devOrsak });
        }
      }
      // Batchad radering (ett anrop för alla VNR) istället för ett DELETE per
      // VNR i loopen — samma nettoeffekt, men N+1 sekventiella round trips
      // mot Supabase blir en.
      if (devIdsToClear.length > 0) {
        const { error: delErr } = await supabase.from("scans").delete().in("deviation_id", devIdsToClear);
        if (delErr) throw new Error(delErr.message);
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
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Spara backup ─────────────────────────────────────────────────────────
  async function handleBackupSave(mode) {
    if (!backupRecords) return;
    if (mode === "återställ" && !window.confirm("All befintlig data raderas och ersätts med backup-filens innehåll. Fortsätta?")) return;
    setBackupSaving(true); setBackupStatus(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const uid = user.id;
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
        await batchWrite(backupRecords.map((r) => cleanDeviationRow({ ...r, user_id: uid })));
        setBackupStatus({ ok: true, msg: `${backupRecords.length} poster återställda från backup.` });
      } else {
        const byKey  = new Map(deviations.map((r) => [`${r.datum}|${r.vnr}`, r]));
        const rows   = backupRecords.map((r) => {
          const prev = byKey.get(`${r.datum}|${r.vnr}`);
          return cleanDeviationRow({ ...r, user_id: uid, id: prev?.id,
            orsak:     prev?.orsak && prev.orsak !== "Okänd" ? prev.orsak : (r.orsak || ""),
            kommentar: prev?.kommentar || r.kommentar || "" }, { keepId: true });
        });
        await batchWrite(rows, { onConflict: "org_id,datum,vnr" });
        const nytt = backupRecords.filter((r) => !byKey.has(`${r.datum}|${r.vnr}`)).length;
        setBackupStatus({ ok: true, msg: `${nytt} nya poster tillagda, ${backupRecords.length - nytt} uppdaterade.` });
      }
      await refetch();
      setBackupRecords(null);
    } catch (err) {
      setBackupStatus({ ok: false, msg: err.message });
    } finally {
      setBackupSaving(false);
    }
  }

  // ── Drag & drop ──────────────────────────────────────────────────────────
  function onDragOver(e)  { e.preventDefault(); setDragOver(true); }
  function onDragLeave()  { setDragOver(false); }
  function onDrop(e)      { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }

  // ── Beräkningar ──────────────────────────────────────────────────────────
  const newGroups       = groups.filter((g) => !g.alreadyExists);
  const allNewHaveOrsak = newGroups.every((g) => orsakFor(g));
  const donePct         = newGroups.length === 0 ? 100 : Math.round(newGroups.filter((g) => orsakFor(g)).length / newGroups.length * 100);
  const mixedWarn       = groups.filter((g) => g.kontroll_scans > 0 && g.kontroll_total > 0 && g.kontroll_scans < g.kontroll_total);

  const typeLabel = { x08: "Avvikelsefil (X08)", rader: "Rader-fil", backup: "Backup-fil" };

  return (
    <div style={s.wrap}>

      {/* ── Drop-zon ───────────────────────────────────────────────── */}
      {!loadedType && !loading && (
        <div
          style={{ ...s.dropZone, borderColor: dragOver ? "#7c6af7" : "#2a2a4a", background: dragOver ? "#16162a" : "#0d0d1a" }}
          onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div style={s.dropIcon}>📂</div>
          <div style={s.dropTitle}>Dra hit din fil, eller klicka för att välja</div>
          <div style={s.dropHint}>Avvikelsefil (X08) · Rader-fil · Backup-Excel — appen väljer typ automatiskt</div>
        </div>
      )}

      {/* ── Laddar ─────────────────────────────────────────────────── */}
      {loading && (
        <div style={s.loadingBox}>
          <div style={s.spinner}>⏳</div>
          <div>Läser <strong>{fileName}</strong>…</div>
        </div>
      )}

      {/* ── Byte av fil (visas när något laddats) ──────────────────── */}
      {loadedType && !loading && (
        <div style={s.fileRow}>
          <span style={s.fileChip}>
            {loadedType === "rader" ? "📊" : loadedType === "backup" ? "💾" : "📋"} {fileName}
            <span style={s.fileType}> · {typeLabel[loadedType]}</span>
          </span>
          <button
            style={s.changeBtn}
            onClick={() => { setLoadedType(null); setSaved(false); setError(null); setRaderInfo(null); setBackupRecords(null); setBackupStatus(null); setGroups([]); setMergeInfo(null); }}
          >
            Byt fil
          </button>
        </div>
      )}

      <input type="file" ref={fileInputRef} accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />

      {/* ── Datum — visas bara när det behövs ─────────────────────── */}
      {needsDatum && (
        <div style={s.datumBox}>
          <label style={s.datumLabel}>Ange datum för filen</label>
          <input
            type="date"
            value={datum}
            onChange={(e) => { setDatum(e.target.value); setError(null); setNeedsDatum(false); }}
            style={s.dateInput}
            autoFocus
          />
          {datum && (
            <button style={s.retryBtn} onClick={() => { if (fileInputRef.current) fileInputRef.current.click(); }}>
              Välj fil igen med detta datum
            </button>
          )}
        </div>
      )}

      {/* ── Fel ────────────────────────────────────────────────────── */}
      {error && (
        <div style={s.error}>
          <span style={{ fontSize: 18 }}>⚠</span>
          <div>
            <strong>Något gick fel</strong>
            <div style={{ marginTop: 4, color: "#fca5a5" }}>{error}</div>
          </div>
        </div>
      )}

      {/* ══════════ RADER-RESULTAT ═══════════════════════════════════ */}
      {raderInfo && (
        <div style={s.successBox}>
          <div style={s.successTitle}>✓ Rader sparade för {raderInfo.datum}</div>
          <div style={s.raderGrid}>
            <div style={s.raderCell}><span style={s.raderNum}>{raderInfo.zon1.toLocaleString("sv-SE")}</span><span style={s.raderLabel}>Zon 1</span></div>
            <div style={s.raderCell}><span style={s.raderNum}>{raderInfo.zon2.toLocaleString("sv-SE")}</span><span style={s.raderLabel}>Zon 2</span></div>
            <div style={s.raderCell}><span style={s.raderNum}>{raderInfo.zon3.toLocaleString("sv-SE")}</span><span style={s.raderLabel}>Zon 3</span></div>
            <div style={{ ...s.raderCell, borderLeft: "1px solid #2a2a4a" }}><span style={{ ...s.raderNum, color: "#f0f0f5" }}>{raderInfo.total.toLocaleString("sv-SE")}</span><span style={s.raderLabel}>Totalt</span></div>
          </div>
          <div style={{ fontSize: 12, color: "#555", marginTop: 8 }}>Promille-beräkningarna i Statistik uppdateras automatiskt.</div>
        </div>
      )}

      {/* ══════════ BACKUP-RESULTAT ══════════════════════════════════ */}
      {backupRecords && !backupStatus && (
        <div style={s.backupBox}>
          <div style={s.backupTitle}>💾 Backup innehåller <strong>{backupRecords.length}</strong> poster — vad vill du göra?</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              style={{ ...s.backupBtn, background: "#0d1a0d", color: "#4ade80", border: "1px solid #1a3a1a" }}
              onClick={() => handleBackupSave("lägg till")}
              disabled={backupSaving}
            >
              {backupSaving ? "Sparar…" : "Lägg till (behåll befintlig data)"}
            </button>
            {isAdmin && (
              <button
                style={{ ...s.backupBtn, background: "#1a0d0d", color: "#f87171", border: "1px solid #3a1515" }}
                onClick={() => handleBackupSave("återställ")}
                disabled={backupSaving}
              >
                {backupSaving ? "Sparar…" : "Återställ (ersätt all data)"}
              </button>
            )}
          </div>
          {!isAdmin && (
            <div style={{ fontSize: 12, color: "#555", marginTop: 8 }}>
              Bara admin kan ersätta all data — fråga en admin i teamet om det behövs.
            </div>
          )}
        </div>
      )}
      {backupStatus && (
        <div style={{ ...s.successBox, borderColor: backupStatus.ok ? "#1a3a1a" : "#4a1515" }}>
          <div style={{ color: backupStatus.ok ? "#4ade80" : "#f87171", fontWeight: 700 }}>
            {backupStatus.ok ? "✓ " : "⚠ "}{backupStatus.msg}
          </div>
        </div>
      )}

      {/* ══════════ X08 — AVVIKELSE-RESULTAT ════════════════════════ */}
      {groups.length > 0 && (
        <>
          {/* Sammandrag + spara-knapp */}
          <div style={s.x08Header}>
            <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              {mergeInfo && (
                <>
                  <span style={{ fontSize: 12, color: "#4ade80" }}>✓ {mergeInfo.updated} uppdaterade</span>
                  <span style={{ fontSize: 12, color: "#7c6af7" }}>＋ {mergeInfo.added} nya att bedöma</span>
                </>
              )}
              {newGroups.length > 0 && (
                <span style={{ fontSize: 11, color: "#888" }}>
                  {newGroups.filter((g) => orsakFor(g)).length}/{newGroups.length} orsaker satta
                  <span style={s.progressBg}><span style={{ ...s.progressFill, width: `${donePct}%` }} /></span>
                </span>
              )}
            </div>
            <button
              onClick={handleSave}
              disabled={saved || !datum || saving}
              style={{
                ...s.saveBtn,
                background: saved ? "#2a2a3a" : allNewHaveOrsak ? "#7c6af7" : "#4ade80",
                color: saved ? "#555" : "#0a0a0f",
                cursor: saved ? "not-allowed" : "pointer",
              }}
            >
              {saving ? "Sparar…" : saved ? "✓ Sparat" : allNewHaveOrsak ? "Spara alla" : `Spara (${newGroups.filter((g) => !orsakFor(g)).length} saknar orsak)`}
            </button>
          </div>

          {/* Kontroll-varning */}
          {mixedWarn.length > 0 && (
            <div style={s.kontrollWarn}>
              ⚠ <strong>{mixedWarn.length} VNR</strong> har scannar både i kontrollkedja och utanför — granska:{" "}
              {mixedWarn.map((g) => `${g.vnr} (${g.kontroll_scans}/${g.kontroll_total} i kedja)`).join(" · ")}
            </div>
          )}

          {/* Nya poster */}
          {newGroups.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={s.sectionHeader}>Nya avvikelser att bedöma ({newGroups.length})</div>
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
                        {g.kontroll_scans > 0 && <span style={{ color: "#e879c5", fontSize: 10, marginLeft: 8 }}>{g.kontroll_scans}/{g.kontroll_total} i kedja</span>}
                      </span>
                      <span style={{ ...s.countBadge, color: g.count >= 10 ? "#f97316" : "#f0f0f5" }}>×{g.count}</span>
                      <span style={{ ...s.zonBadge, background: ZON_BG[g.zon] }}>Z{g.zon || "?"}</span>
                    </div>
                    <div style={s.editRow}>
                      <OrsaksSelect value={orsakFor(g)} onChange={(v) => setLocalOrsak((p) => ({ ...p, [g.vnr]: v }))} />
                      <input
                        placeholder="Kommentar (valfritt)…"
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

          {/* Befintliga poster (kollapsad) */}
          {groups.filter((g) => g.alreadyExists).length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={s.sectionHeader}>Redan inlagda (orsak behållen) — {groups.filter((g) => g.alreadyExists).length} st</div>
              <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>
                {groups.filter((g) => g.alreadyExists).map((g) => g.vnr).join(" · ")}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Sparat-bekräftelse ─────────────────────────────────────── */}
      {saved && (
        <div style={s.successBox}>
          <div style={s.successTitle}>✓ Sparat!</div>
          <div style={{ fontSize: 13, color: "#888" }}>Öppna <strong>Historik</strong>-fliken för att se och redigera avvikelserna.</div>
        </div>
      )}

    </div>
  );
}

const s = {
  wrap:         { padding: "24px 24px", fontFamily: "system-ui, sans-serif", background: "#0a0a0f", minHeight: "100%", color: "#f0f0f5", maxWidth: 900 },

  // Drop-zon
  dropZone:     { border: "2px dashed", borderRadius: 16, padding: "60px 32px", textAlign: "center", cursor: "pointer", transition: "all .15s", userSelect: "none", marginBottom: 24 },
  dropIcon:     { fontSize: 48, marginBottom: 12 },
  dropTitle:    { fontSize: 18, fontWeight: 700, color: "#f0f0f5", marginBottom: 8 },
  dropHint:     { fontSize: 13, color: "#555" },

  // Laddar
  loadingBox:   { textAlign: "center", padding: 60, color: "#888", fontSize: 14 },
  spinner:      { fontSize: 32, marginBottom: 12 },

  // Fil-info-rad
  fileRow:      { display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" },
  fileChip:     { background: "#13131c", border: "1px solid #2a2a4a", borderRadius: 8, padding: "8px 14px", fontSize: 13, color: "#f0f0f5" },
  fileType:     { color: "#7c6af7", fontSize: 11 },
  changeBtn:    { background: "none", border: "1px solid #2a2a4a", borderRadius: 8, color: "#888", fontSize: 12, padding: "6px 14px", cursor: "pointer", fontFamily: "inherit" },

  // Datum
  datumBox:     { background: "#0d0d1a", border: "1px solid #2a2a4a", borderRadius: 12, padding: "20px 24px", marginBottom: 20, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" },
  datumLabel:   { fontSize: 14, color: "#f0f0f5", fontWeight: 600 },
  dateInput:    { background: "#13131c", border: "1px solid #2a2a3a", color: "#f0f0f5", borderRadius: 8, padding: "8px 12px", fontSize: 14, outline: "none" },
  retryBtn:     { background: "#7c6af7", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" },

  // Fel
  error:        { background: "#1a0808", border: "1px solid #4a1515", borderRadius: 12, padding: "14px 20px", fontSize: 13, color: "#f87171", marginBottom: 20, display: "flex", gap: 14, alignItems: "flex-start" },

  // Rader-resultat
  successBox:   { background: "#0d1a0d", border: "1px solid #1a3a1a", borderRadius: 12, padding: "20px 24px", marginBottom: 20 },
  successTitle: { fontSize: 15, fontWeight: 700, color: "#4ade80", marginBottom: 12 },
  raderGrid:    { display: "flex", gap: 0 },
  raderCell:    { flex: 1, textAlign: "center", padding: "8px 0" },
  raderNum:     { display: "block", fontSize: 22, fontWeight: 700, color: "#7c6af7", fontFamily: "monospace" },
  raderLabel:   { display: "block", fontSize: 11, color: "#666", marginTop: 2 },

  // Backup
  backupBox:    { background: "#13131c", border: "1px solid #2a2a4a", borderRadius: 12, padding: "20px 24px", marginBottom: 20 },
  backupTitle:  { fontSize: 14, color: "#f0f0f5", marginBottom: 16 },
  backupBtn:    { borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" },

  // X08
  x08Header:    { display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", background: "#0d0d1a", border: "1px solid #1e1e2e", borderRadius: 10, padding: "12px 16px", marginBottom: 12 },
  progressBg:   { display: "inline-block", width: 80, height: 4, background: "#2a2a3a", borderRadius: 2, marginLeft: 8, verticalAlign: "middle" },
  progressFill: { display: "block", height: "100%", background: "#7c6af7", borderRadius: 2, transition: "width .3s" },
  saveBtn:      { borderRadius: 8, padding: "10px 24px", fontWeight: 700, fontSize: 13, border: "none", letterSpacing: 0.5, whiteSpace: "nowrap", fontFamily: "inherit" },
  kontrollWarn: { background: "#1a0d18", border: "1px solid #6a2a5a", borderRadius: 8, padding: "10px 16px", marginBottom: 12, fontSize: 12, color: "#e879c5" },
  sectionHeader:{ fontSize: 11, color: "#7c6af7", fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 },
  rowList:      { display: "flex", flexDirection: "column", gap: 6 },
  devRow:       { background: "#13131c", border: "1px solid #1e1e2e", borderRadius: 8, padding: "10px 12px" },
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
};
