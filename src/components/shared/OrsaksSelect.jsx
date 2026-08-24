import { ORSAKER } from "../../lib/causes.js";

export function OrsaksSelect({ value, onChange, style }) {
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      style={{ fontSize: 13, padding: "2px 4px", borderRadius: 4, border: "1px solid #2a2a3a", background: "#0f0f18", color: "#f0f0f5", fontFamily: "inherit", ...style }}
    >
      <option value="">— välj orsak —</option>
      {ORSAKER.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}
