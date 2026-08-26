import { useMemo, useState } from "react";
import { supabase } from "../../lib/supabase.js";
import { deleteDays } from "../../lib/deleteDays.js";
import { totalRader } from "../../lib/rader.js";

// Admin-only, två-stegs bekräftelse för att radera hela dagar (alla VNR-rader,
// deras scans, och rad-antalen för dagen). Ingen textbekräftelse — bara
// flera separata knapptryckningar, med tydliga siffror på vad som försvinner
// innan man kan nå den sista "radera för alltid"-knappen.
export function DeleteDaysModal({ dates, deviations, rader, onClose, onDeleted }) {
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const sortedDates = useMemo(() => [...dates].sort(), [dates]);

  const devInScope = useMemo(
    () => deviations.filter((d) => dates.includes(String(d.datum).slice(0, 10))),
    [deviations, dates]
  );
  const totalAvvikelser = devInScope.reduce((sum, d) => sum + (d.count || 0), 0);
  const raderInScope = rader
    .filter((r) => dates.includes(String(r.datum).slice(0, 10)))
    .reduce((sum, r) => sum + totalRader(r), 0);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      await deleteDays(supabase, dates);
      onDeleted();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const dayWord = dates.length === 1 ? "dagen" : `${dates.length} dagarna`;

  return (
    <div style={s.overlay} onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div style={s.modal}>
        <div style={s.title}>Radera {dayWord}?</div>

        <div style={s.dateList}>
          {sortedDates.length <= 8
            ? sortedDates.join(", ")
            : `${sortedDates.slice(0, 6).join(", ")} … och ${sortedDates.length - 6} till`}
        </div>

        <div style={s.stats}>
          <strong style={{ color: "#f0f0f5" }}>{devInScope.length}</strong> VNR-rader ·{" "}
          <strong style={{ color: "#f0f0f5" }}>{totalAvvikelser}</strong> avvikelser ·{" "}
          <strong style={{ color: "#f0f0f5" }}>{raderInScope.toLocaleString("sv-SE")}</strong> plockade rader raderas permanent.
        </div>

        {step === 1 && (
          <>
            <div style={s.hint}>
              Detta tar bort ALL data för {dayWord} — oavsett andra filter (orsak, zon, sök) som
              råkar vara aktiva just nu. Det går inte att ångra.
            </div>
            <div style={s.row}>
              <button onClick={onClose} style={s.btnCancel}>Avbryt</button>
              <button onClick={() => setStep(2)} style={s.btnNext}>Fortsätt →</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div style={s.danger}>
              ⚠ Är du helt säker? {dayWord[0].toUpperCase() + dayWord.slice(1)} försvinner permanent
              — det finns ingen papperskorg. Ta en backup (Historik → Exportera Excel) först om du
              vill kunna återställa datan senare.
            </div>
            {error && <div style={s.error}>Kunde inte radera: {error}</div>}
            <div style={s.row}>
              <button onClick={onClose} disabled={busy} style={s.btnCancel}>Avbryt</button>
              <button onClick={handleConfirm} disabled={busy} style={s.btnDanger}>
                {busy ? "Raderar…" : "Radera för alltid"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const s = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 },
  modal:   { background: "#13131c", border: "1px solid #7c2a2a", borderRadius: 14, padding: "24px 28px", width: "min(480px, 92vw)", fontFamily: "system-ui, sans-serif" },
  title:   { fontSize: 16, fontWeight: 700, color: "#f0f0f5", marginBottom: 10 },
  dateList: { fontSize: 11, fontFamily: "monospace", color: "#7c6af7", marginBottom: 10, lineHeight: 1.6 },
  stats:   { fontSize: 12, color: "#a0a0c0", marginBottom: 14, lineHeight: 1.6 },
  hint:    { fontSize: 12, color: "#888", marginBottom: 4, lineHeight: 1.5 },
  danger:  { fontSize: 12, color: "#f87171", background: "#1e1015", border: "1px solid #4a1e1e", borderRadius: 8, padding: "10px 12px", marginBottom: 4, lineHeight: 1.5 },
  error:   { fontSize: 12, color: "#f87171", marginTop: 10 },
  row:     { display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" },
  btnCancel: { background: "none", color: "#888", border: "1px solid #2a2a3a", borderRadius: 8, padding: "9px 18px", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit" },
  btnNext:   { background: "#7c6af7", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" },
  btnDanger: { background: "#c0392b", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" },
};
