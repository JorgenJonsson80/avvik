import { useState } from "react";
import { useActions } from "../../hooks/useActions.js";

export function LoggaAtgardModal({ vnr, location, kbana, onClose }) {
  const { addAction } = useActions();
  const [text, setText] = useState("");
  const [av, setAv] = useState("");
  const [saving, setSaving] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  async function submit() {
    if (!text.trim()) return;
    setSaving(true);
    await addAction({ vnr, datum: today, text: text.trim(), av: av.trim() || null, location: location || null, kbana: kbana || null });
    onClose();
  }

  return (
    <div style={s.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={s.modal}>
        <div style={s.title}>Ny åtgärd · <span style={{ color: "#60a5fa", fontFamily: "monospace" }}>{vnr}</span></div>
        {(location || kbana) && (
          <div style={s.sub}>{[location, kbana].filter(Boolean).join(" · ")}</div>
        )}
        <input
          autoFocus
          placeholder="Vad gjorde du? T.ex. Korrigerat saldo, Ändrat PF-punkt…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          style={s.input}
        />
        <input
          placeholder="Av vem? (frivilligt)"
          value={av}
          onChange={(e) => setAv(e.target.value)}
          style={{ ...s.input, marginTop: 8 }}
        />
        <div style={s.row}>
          <button onClick={submit} disabled={!text.trim() || saving} style={{ ...s.btn, background: text.trim() ? "#7c6af7" : "#2a2a3a", color: text.trim() ? "#fff" : "#555", cursor: text.trim() ? "pointer" : "default" }}>
            {saving ? "Sparar…" : "Spara åtgärd"}
          </button>
          <button onClick={onClose} style={{ ...s.btn, background: "none", color: "#888", border: "1px solid #2a2a3a" }}>Avbryt</button>
        </div>
        <div style={s.hint}>Datum sätts till idag ({today}) — används som mätgräns för att se om åtgärden hjälpte.</div>
      </div>
    </div>
  );
}

const s = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 },
  modal:   { background: "#13131c", border: "1px solid #7c6af7", borderRadius: 14, padding: "24px 28px", width: "min(480px, 92vw)", display: "flex", flexDirection: "column", gap: 0 },
  title:   { fontSize: 16, fontWeight: 700, color: "#f0f0f5", marginBottom: 6 },
  sub:     { fontSize: 12, color: "#666", marginBottom: 16 },
  input:   { background: "#0a0a0f", border: "1px solid #2a2a3a", borderRadius: 8, color: "#f0f0f5", padding: "10px 14px", fontFamily: "inherit", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box" },
  row:     { display: "flex", gap: 10, marginTop: 16 },
  btn:     { borderRadius: 8, padding: "9px 20px", fontWeight: 700, fontSize: 13, border: "none", fontFamily: "inherit", whiteSpace: "nowrap" },
  hint:    { fontSize: 11, color: "#444", marginTop: 12 },
};
