import { useState } from "react";
import { useScans } from "../../hooks/useScans.js";
import { OrsaksSelect } from "./OrsaksSelect.jsx";
import { ORSAKER } from "../../lib/causes.js";

export function ScanDetailModal({ deviation, onClose, onSave }) {
  const { scans, loading, updateScanOrsak } = useScans(deviation.id);
  const [localOrsak, setLocalOrsak] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  function orsakFor(scan) {
    return localOrsak[scan.id] !== undefined ? localOrsak[scan.id] : (scan.orsak || deviation.orsak || "");
  }

  function setAll(val) {
    const patch = {};
    scans.forEach((s) => { patch[s.id] = val; });
    setLocalOrsak(patch);
  }

  // Beräkna dominant orsak från aktuella values
  const counts = {};
  scans.forEach((s) => {
    const o = orsakFor(s) || "";
    if (o) counts[o] = (counts[o] || 0) + 1;
  });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const dominant = entries[0]?.[0] ?? deviation.orsak ?? "";
  const isMixed = entries.length > 1;

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      for (const [id, orsak] of Object.entries(localOrsak)) {
        await updateScanOrsak(id, orsak);
      }
      await onSave(dominant);
    } catch (e) {
      setSaveError(`Kunde inte spara alla orsaker (${e.message}) — de som redan sparats är kvar, försök igen.`);
    } finally {
      setSaving(false);
    }
  }

  const sorted = [...scans].sort((a, b) => (a.tid || "").localeCompare(b.tid || ""));

  return (
    <div onClick={onClose} style={s.overlay}>
      <div onClick={(e) => e.stopPropagation()} style={s.modal}>
        {/* Header */}
        <div style={s.header}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={s.vnr}>{deviation.vnr}</span>
            <span style={s.datum}>{deviation.datum}</span>
            <span style={{ ...s.zonBadge, background: ZON_BG[deviation.zon] }}>Z{deviation.zon}</span>
            {deviation.kbana && <span style={s.kbana}>{deviation.kbana}</span>}
            <span style={s.scanCount}>{scans.length} scans</span>
          </div>
          {isMixed && (
            <div style={s.mixedWarning}>
              ⚠ Blandade orsaker: {entries.map(([o, n]) => `${o} ×${n}`).join(" · ")}
            </div>
          )}
        </div>

        {/* Sätt alla */}
        <div style={s.setAll}>
          <span style={s.dim}>Sätt alla till:</span>
          <select
            defaultValue=""
            onChange={(e) => { if (e.target.value) setAll(e.target.value); e.target.value = ""; }}
            style={s.selectSmall}
          >
            <option value="">— välj —</option>
            {ORSAKER.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>

        {/* Scan-lista */}
        <div style={s.list}>
          {loading && <div style={s.placeholder}>Laddar scans…</div>}
          {!loading && sorted.length === 0 && (
            <div style={s.placeholder}>
              Inga scan-detaljer sparade för den här posten.<br />
              <span style={{ fontSize: 11, color: "#444" }}>(Post importerad innan per-scan-detaljer infördes.)</span>
            </div>
          )}
          {sorted.map((scan) => (
            <div key={scan.id} style={{ ...s.scanRow, background: scan.in_kontroll ? "#15101a" : "#13131c", borderColor: scan.in_kontroll ? "#3a2348" : "#1e1e2e" }}>
              <span style={s.tid}>🕐 {scan.tid || "—"}</span>
              <div style={s.scanMeta}>
                <span style={s.loc}>{scan.location || "—"}</span>
                {scan.in_kontroll && <span style={s.iKedja}>i kedja</span>}
                {scan.route_code && <span style={s.dim}> Tur {scan.route_code}</span>}
                {scan.avgangstid && <span style={s.avg}> avg {scan.avgangstid}</span>}
              </div>
              <OrsaksSelect
                value={orsakFor(scan)}
                onChange={(v) => setLocalOrsak((p) => ({ ...p, [scan.id]: v }))}
              />
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={s.footer}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={s.dim}>
              Dominant orsak: <strong style={{ color: "#c0c0d0" }}>{dominant || "—"}</strong>
              {isMixed && <span style={{ color: "#e879c5" }}> (blandad — VNR-dagen får dominant orsak)</span>}
            </span>
            {saveError && <span style={{ fontSize: 11, color: "#f87171" }}>{saveError}</span>}
          </div>
          <button onClick={onClose} style={s.btnCancel}>Avbryt</button>
          <button
            onClick={handleSave}
            disabled={saving || scans.length === 0}
            style={{ ...s.btnSave, opacity: scans.length === 0 ? 0.4 : 1 }}
          >
            {saving ? "Sparar…" : "Spara orsaker"}
          </button>
        </div>
      </div>
    </div>
  );
}

const ZON_BG = { "1": "#4ade80", "2": "#60a5fa", "3": "#f97316", "?": "#6b7280" };

const s = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 },
  modal: { background: "#0f0f18", border: "1px solid #2a2a3a", borderRadius: 12, maxWidth: 720, width: "100%", maxHeight: "85vh", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif" },
  header: { padding: "18px 22px", borderBottom: "1px solid #1e1e2e" },
  vnr: { fontSize: 16, fontWeight: 800, fontFamily: "monospace", color: "#f0f0f5" },
  datum: { fontSize: 12, color: "#7c6af7" },
  zonBadge: { color: "#0a0a0f", borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700, fontFamily: "monospace", letterSpacing: 1 },
  kbana: { color: "#f97316", fontSize: 11, fontWeight: 700 },
  scanCount: { marginLeft: "auto", fontSize: 12, color: "#666" },
  mixedWarning: { marginTop: 8, fontSize: 11, color: "#e879c5" },
  setAll: { padding: "10px 22px", borderBottom: "1px solid #1e1e2e", display: "flex", alignItems: "center", gap: 8 },
  selectSmall: { background: "#16161f", color: "#f0f0f5", border: "1px solid #2a2a3a", borderRadius: 6, padding: "4px 8px", fontSize: 11, cursor: "pointer" },
  list: { overflowY: "auto", padding: "12px 22px", flex: 1, display: "flex", flexDirection: "column", gap: 5 },
  placeholder: { color: "#555", fontSize: 12, textAlign: "center", padding: "30px 0" },
  scanRow: { display: "grid", gridTemplateColumns: "72px 1fr 180px", gap: 10, alignItems: "center", border: "1px solid", borderRadius: 6, padding: "7px 10px" },
  tid: { fontFamily: "monospace", fontSize: 12, color: "#7c6af7" },
  scanMeta: { fontSize: 11, color: "#8a8a9a", fontFamily: "monospace" },
  loc: { color: "#8a8a9a" },
  iKedja: { color: "#e879c5", marginLeft: 8, fontWeight: 700 },
  avg: { color: "#60a5fa" },
  dim: { fontSize: 11, color: "#666" },
  footer: { padding: "14px 22px", borderTop: "1px solid #1e1e2e", display: "flex", alignItems: "center", gap: 12 },
  btnCancel: { marginLeft: "auto", background: "#1e1e2e", color: "#888", border: "none", borderRadius: 6, padding: "7px 16px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" },
  btnSave: { background: "#7c6af7", color: "#fff", border: "none", borderRadius: 6, padding: "7px 18px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
};
