import { useState, useMemo } from "react";
import { useDeviations } from "../hooks/useDeviations.js";
import { useRader } from "../hooks/useRader.js";
import { useSettings } from "../hooks/useSettings.js";
import { classifyLocation, ALLA_ZONER } from "../lib/classify.js";
import { fmtKr, fmtTimmar } from "../lib/dates.js";

// ─── Veckologik ──────────────────────────────────────────────────────────────

function toMonday(dateStr) {
  const dt = new Date(dateStr);
  const day = (dt.getDay() + 6) % 7; // Mon=0
  dt.setDate(dt.getDate() - day);
  return dt.toISOString().slice(0, 10);
}

function weekLabel(mondayStr) {
  const dt = new Date(mondayStr);
  const sun = new Date(dt);
  sun.setDate(sun.getDate() + 6);
  const fmt = (d) => `${d.getDate()}/${d.getMonth() + 1}`;
  return `${fmt(dt)}–${fmt(sun)}`;
}

function weekdayIdx(dateStr) {
  return (new Date(dateStr).getDay() + 6) % 7; // Mon=0…Sun=6
}

// ─── Hjälpare ────────────────────────────────────────────────────────────────

const SWE_DAYS = ["Mån","Tis","Ons","Tor","Fre","Lör","Sön"];
const ZON_COLOR = { "1": "#4ade80", "2": "#60a5fa", "3": "#f97316" };

function sumCount(arr) { return arr.reduce((s, r) => s + (r.count || 0), 0); }

function sumByZon(arr) {
  const m = {};
  arr.forEach((r) => { const z = r.zon || "?"; m[z] = (m[z] || 0) + (r.count || 0); });
  return m;
}

function sumByKbana(arr) {
  const m = {};
  arr.forEach((r) => {
    const kb = r.kbana || classifyLocation(r.locations?.[0]) || "";
    if (kb) m[kb] = (m[kb] || 0) + (r.count || 0);
  });
  return m;
}

function criticalCount(arr) {
  return arr.filter((r) => r.min_fore_avgang != null && !r.nasta_dag && r.min_fore_avgang < 30)
    .reduce((s, r) => s + (r.count || 0), 0);
}

function promille(avv, rad) { return rad > 0 ? (avv / rad * 1000) : null; }
function fmtProm(v) { return v === null ? "—" : v.toFixed(2) + " ‰"; }
function goalColor(p, goal) {
  if (p === null) return "#60a5fa";
  if (p <= goal) return "#4ade80";
  if (p <= goal * 1.25) return "#fbbf24";
  return "#f87171";
}

// ─── VeckaTab ────────────────────────────────────────────────────────────────

export function VeckaTab() {
  const { deviations, loading } = useDeviations();
  const { getRaderForDatum }    = useRader();
  const { settings }            = useSettings();

  const [weekIdx, setWeekIdx] = useState(0);
  const [copiedKey, setCopiedKey] = useState(null);
  const copyText = (text, key) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1800);
    }).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); setCopiedKey(key); setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1800); } catch (e) {}
      document.body.removeChild(ta);
    });
  };

  const cost     = parseFloat(settings.cost)     || 63;
  const timePMin = parseFloat(settings.time_min) || 13;
  const goal     = parseFloat(settings.goal)     || 2.0;

  // Gruppera per vecka (måndag)
  const weekMap = useMemo(() => {
    const m = {};
    deviations.forEach((r) => {
      const k = toMonday(r.datum);
      if (!m[k]) m[k] = [];
      m[k].push(r);
    });
    return m;
  }, [deviations]);

  const weekKeys = useMemo(
    () => Object.keys(weekMap).sort().reverse(),
    [weekMap]
  );

  const currentKey = weekKeys[weekIdx];
  const prevKey    = weekKeys[weekIdx + 1];
  const current    = weekMap[currentKey] || [];
  const prevFull   = prevKey ? (weekMap[prevKey] || []) : [];

  // Matcha föregående vecka mot samma veckodagar som aktuell vecka
  const currWeekdays = new Set(current.map((r) => weekdayIdx(r.datum)));
  const prev         = prevFull.filter((r) => currWeekdays.has(weekdayIdx(r.datum)));

  const currTotal = sumCount(current);
  const prevTotal = sumCount(prev);
  const diffPct   = prevTotal > 0 ? Math.round((currTotal - prevTotal) / prevTotal * 100) : null;

  const currKostnad = currTotal * cost;
  const prevKostnad = prevTotal * cost;

  // Rader för aktuell vecka
  const currRader = useMemo(() => {
    const days = [...new Set(current.map((r) => r.datum))];
    let tot = 0;
    days.forEach((d) => {
      const rd = getRaderForDatum(d);
      tot += (rd.zon1 || 0) + (rd.zon2 || 0) + (rd.zon3 || 0);
    });
    return tot;
  }, [current, getRaderForDatum]);

  const currProm = promille(currTotal, currRader);

  // Dagar under mål
  const daysInWeek = [...new Set(current.map((r) => r.datum))];
  const daysWithRader = daysInWeek.filter((d) => {
    const rd = getRaderForDatum(d);
    return (rd.zon1 || 0) + (rd.zon2 || 0) + (rd.zon3 || 0) > 0;
  });
  const daysUnderGoal = daysWithRader.filter((d) => {
    const avv = current.filter((r) => r.datum === d).reduce((s, r) => s + r.count, 0);
    const rd  = getRaderForDatum(d);
    const tot = (rd.zon1 || 0) + (rd.zon2 || 0) + (rd.zon3 || 0);
    return promille(avv, tot) !== null && promille(avv, tot) <= goal;
  }).length;

  // Zon-jämförelse
  const currByZon = sumByZon(current);
  const prevByZon = sumByZon(prev);

  // K-bana förändring
  const currKbana    = sumByKbana(current);
  const prevKbana    = sumByKbana(prev);
  const allKbanas    = [...new Set([...Object.keys(currKbana), ...Object.keys(prevKbana)])];
  const kbanaChanges = allKbanas.map((k) => ({
    k, curr: currKbana[k] || 0, prev: prevKbana[k] || 0,
    diff: (currKbana[k] || 0) - (prevKbana[k] || 0),
  }));
  const improved = [...kbanaChanges].filter((c) => c.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 5);
  const worsened = [...kbanaChanges].filter((c) => c.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 5);

  // Dag-för-dag i aktuell vecka
  const dayBreakdown = useMemo(() => daysInWeek.sort().map((d) => {
    const recs = current.filter((r) => r.datum === d);
    const avv  = sumCount(recs);
    const rd   = getRaderForDatum(d);
    const tot  = (rd.zon1 || 0) + (rd.zon2 || 0) + (rd.zon3 || 0);
    const p    = promille(avv, tot);
    const wi   = weekdayIdx(d);
    return { datum: d, dag: SWE_DAYS[wi], avv, rader: tot, prom: p };
  }), [daysInWeek, current, getRaderForDatum]);

  const formatWeekReport = () => {
    const lines = [];
    lines.push(`Veckorapport ${weekLabel(currentKey)}`);
    lines.push("");
    lines.push(`Totalt: ${currTotal} avvikelser` + (diffPct !== null ? ` (${diffPct > 0 ? "+" : ""}${diffPct}% mot förra veckan)` : ""));
    if (prevKey) lines.push(`Förra veckan: ${prevTotal} avvikelser (${weekLabel(prevKey)})`);
    lines.push(`Kostnad: ${fmtKr(currKostnad)}` + (prevTotal > 0 ? ` (${currKostnad > prevKostnad ? "+" : ""}${fmtKr(currKostnad - prevKostnad)})` : ""));
    lines.push(`Nedlagd tid: ${fmtTimmar(currTotal * timePMin)}`);
    if (currProm !== null) lines.push(`Avvikelsegrad: ${currProm.toFixed(2)}‰` + (currProm > goal ? " (över mål)" : " (under mål)"));
    lines.push(`Kritiska (<30 min före avgång): ${criticalCount(current)}`);
    const minForeVals = (arr) => arr.filter((r) => r.min_fore_avgang != null && !r.nasta_dag).map((r) => r.min_fore_avgang);
    const avgMinFore  = (vals) => vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
    const currAvgMin  = avgMinFore(minForeVals(current));
    const prevAvgMin  = avgMinFore(minForeVals(prev));
    if (currAvgMin !== null) {
      const diffMin = prevAvgMin !== null ? currAvgMin - prevAvgMin : null;
      lines.push(`Snitt min före avgång: ${currAvgMin} min` + (diffMin !== null ? ` (${diffMin > 0 ? "+" : ""}${diffMin} min mot förra veckan)` : ""));
    }
    const zonerMedData = ALLA_ZONER.filter((z) => (currByZon[z] || 0) > 0 || (prevByZon[z] || 0) > 0);
    if (zonerMedData.length > 0) {
      lines.push(""); lines.push("Per zon:");
      for (const z of zonerMedData) {
        const c = currByZon[z] || 0, p = prevByZon[z] || 0, diff = c - p;
        const label = /^\d+$/.test(z) ? `Zon ${z}` : z;
        lines.push(`  ${label}: ${c}` + (prevKey ? ` (${p} förra veckan, ${diff > 0 ? "+" : ""}${diff})` : ""));
      }
    }
    if (worsened.length > 0) lines.push("Försämrade K-banor: " + worsened.map((c) => `${c.k} (${c.prev}→${c.curr}, +${c.diff})`).join(", "));
    if (improved.length > 0) lines.push("Förbättrade K-banor: " + improved.map((c) => `${c.k} (${c.prev}→${c.curr}, ${c.diff})`).join(", "));
    return lines.join("\n");
  };

  if (loading) return <div style={s.status}>Laddar…</div>;
  if (weekKeys.length === 0) return <div style={s.status}>Inga data ännu. Importera avvikelser.</div>;

  return (
    <div style={s.wrap}>
      {/* Vecko-nav */}
      <div style={s.nav}>
        <button onClick={() => setWeekIdx((i) => Math.min(i + 1, weekKeys.length - 1))} disabled={weekIdx >= weekKeys.length - 1} style={s.navBtn}>←</button>
        <div style={{ textAlign: "center" }}>
          <div style={s.weekTitle}>{weekLabel(currentKey)}</div>
          <div style={{ fontSize: 11, color: "#555" }}>Vecka {weekIdx === 0 ? "— senaste" : weekIdx + 1} · {currentKey}</div>
        </div>
        <button onClick={() => setWeekIdx((i) => Math.max(i - 1, 0))} disabled={weekIdx === 0} style={s.navBtn}>→</button>
        <button
          onClick={() => copyText(formatWeekReport(), "report")}
          style={{
            background: copiedKey === "report" ? "#1e3a28" : "#1e1e2e",
            color: copiedKey === "report" ? "#4ade80" : "#888",
            border: "1px solid #2a2a3a", borderRadius: 6, padding: "5px 12px",
            fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
          }}
        >{copiedKey === "report" ? "✓ Kopierat" : "📋 Kopiera rapport"}</button>
      </div>

      {/* Huvud-KPI */}
      <div style={s.kpiGrid}>
        <div style={s.kpi}>
          <div style={{ ...s.kpiVal, color: "#f0f0f5", fontSize: 32 }}>{currTotal}</div>
          <div style={s.kpiLbl}>Avvikelser</div>
          {diffPct !== null && (
            <div style={{ fontSize: 13, fontWeight: 700, color: diffPct > 0 ? "#f87171" : diffPct < 0 ? "#4ade80" : "#888", marginTop: 4 }}>
              {diffPct > 0 ? "↑" : diffPct < 0 ? "↓" : "→"} {Math.abs(diffPct)}% vs förra veckan
            </div>
          )}
        </div>
        <div style={s.kpi}>
          <div style={{ ...s.kpiVal, color: goalColor(currProm, goal) }}>{fmtProm(currProm)}</div>
          <div style={s.kpiLbl}>Avvikelsegrad</div>
          <div style={{ fontSize: 11, color: "#444", marginTop: 3 }}>Mål: {goal.toFixed(1)} ‰</div>
        </div>
        <div style={s.kpi}>
          <div style={{ ...s.kpiVal, color: "#f87171" }}>{criticalCount(current)}</div>
          <div style={s.kpiLbl}>{"< 30 min före avgång"}</div>
        </div>
        <div style={s.kpi}>
          <div style={{ ...s.kpiVal, color: "#60a5fa" }}>{daysWithRader.length > 0 ? `${daysUnderGoal}/${daysWithRader.length}` : "—"}</div>
          <div style={s.kpiLbl}>Dagar under mål</div>
        </div>
        <div style={s.kpi}>
          <div style={{ ...s.kpiVal, color: "#fbbf24", fontSize: 18 }}>{fmtKr(currKostnad)}</div>
          <div style={s.kpiLbl}>Kostnad</div>
          {prevTotal > 0 && (
            <div style={{ fontSize: 11, color: currKostnad > prevKostnad ? "#f87171" : "#4ade80", marginTop: 3 }}>
              {currKostnad > prevKostnad ? "+" : ""}{fmtKr(currKostnad - prevKostnad)} vs förra
            </div>
          )}
        </div>
        <div style={s.kpi}>
          <div style={{ ...s.kpiVal, color: "#f97316", fontSize: 18 }}>{fmtTimmar(currTotal * timePMin)}</div>
          <div style={s.kpiLbl}>Nedlagd tid</div>
        </div>
      </div>

      <div style={s.twoCol}>
        {/* Dag-för-dag */}
        <div style={s.panel}>
          <div style={s.ph}>Dag-för-dag</div>
          {dayBreakdown.map(({ datum, dag, avv, rader, prom }) => (
            <div key={datum} style={s.trendRow}>
              <span style={{ color: "#888", minWidth: 32 }}>{dag}</span>
              <span style={{ fontFamily: "monospace", color: "#8a8a9a", flex: 1 }}>{datum}</span>
              <span style={{ fontFamily: "monospace", color: "#f0f0f5", minWidth: 36, textAlign: "right" }}>{avv}</span>
              <span style={{ fontFamily: "monospace", color: "#555", minWidth: 72, textAlign: "right" }}>{rader ? rader.toLocaleString("sv-SE") : "—"}</span>
              <span style={{ fontFamily: "monospace", fontWeight: 700, color: goalColor(prom, goal), minWidth: 72, textAlign: "right" }}>{fmtProm(prom)}</span>
            </div>
          ))}
          {dayBreakdown.length === 0 && <div style={{ color: "#555", fontSize: 12 }}>Inga data</div>}
        </div>

        {/* Zon-jämförelse */}
        <div style={s.panel}>
          <div style={s.ph}>Per zon (denna vecka vs förra)</div>
          {["1","2","3"].map((z) => {
            const c = currByZon[z] || 0;
            const p = prevByZon[z] || 0;
            const d = c - p;
            return (
              <div key={z} style={s.zonRow}>
                <span style={{ color: ZON_COLOR[z], fontWeight: 700, minWidth: 48 }}>Zon {z}</span>
                <span style={{ fontFamily: "monospace", color: "#888", flex: 1 }}>{p} → {c}</span>
                <span style={{ fontFamily: "monospace", fontWeight: 700, color: d > 0 ? "#f87171" : d < 0 ? "#4ade80" : "#888", minWidth: 40, textAlign: "right" }}>
                  {d > 0 ? `+${d}` : d}
                </span>
              </div>
            );
          })}

          {/* K-bana förbättrade / försämrade */}
          <div style={{ marginTop: 16 }}>
            <div style={s.ph}>↓ Förbättrade K-banor</div>
            {improved.length === 0
              ? <div style={{ color: "#444", fontSize: 12 }}>Inga förbättringar</div>
              : improved.map((c) => (
                <div key={c.k} style={s.kbanaRow}>
                  <span style={{ fontFamily: "monospace", color: "#f97316", fontWeight: 700, minWidth: 56 }}>{c.k}</span>
                  <span style={{ fontFamily: "monospace", color: "#888", flex: 1 }}>{c.prev} → {c.curr}</span>
                  <span style={{ fontFamily: "monospace", color: "#4ade80", fontWeight: 700 }}>{c.diff}</span>
                </div>
              ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={s.ph}>↑ Försämrade K-banor</div>
            {worsened.length === 0
              ? <div style={{ color: "#444", fontSize: 12 }}>Inga försämringar</div>
              : worsened.map((c) => (
                <div key={c.k} style={s.kbanaRow}>
                  <span style={{ fontFamily: "monospace", color: "#f97316", fontWeight: 700, minWidth: 56 }}>{c.k}</span>
                  <span style={{ fontFamily: "monospace", color: "#888", flex: 1 }}>{c.prev} → {c.curr}</span>
                  <span style={{ fontFamily: "monospace", color: "#f87171", fontWeight: 700 }}>+{c.diff}</span>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Föregående vecka info */}
      {prevKey && (
        <div style={s.prevInfo}>
          Förra veckan ({weekLabel(prevKey)}): {prevTotal} avvikelser
          {[...currWeekdays].length < 7 && (
            <span style={{ color: "#fbbf24", marginLeft: 8 }}>
              · matchat mot {[...currWeekdays].length} {[...currWeekdays].length === 1 ? "dag" : "dagar"} (samma veckodagar)
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const s = {
  wrap:      { padding: "16px 20px", fontFamily: "system-ui, sans-serif", background: "#0a0a0f", minHeight: "100%", color: "#f0f0f5" },
  status:    { padding: 40, textAlign: "center", color: "#888" },
  nav:       { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, background: "#13131c", border: "1px solid #1e1e2e", borderRadius: 10, padding: "12px 20px" },
  navBtn:    { background: "none", border: "1px solid #2a2a3a", color: "#888", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 16, fontFamily: "inherit", disabled: { opacity: 0.3 } },
  weekTitle: { fontSize: 18, fontWeight: 700, color: "#f0f0f5" },
  kpiGrid:   { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 16 },
  kpi:       { background: "#13131c", border: "1px solid #1e1e2e", borderRadius: 10, padding: "14px 16px" },
  kpiVal:    { fontSize: 24, fontWeight: 800, fontFamily: "monospace", marginBottom: 4 },
  kpiLbl:    { fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 1 },
  twoCol:    { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 },
  panel:     { background: "#13131c", border: "1px solid #1e1e2e", borderRadius: 8, padding: "14px 16px" },
  ph:        { fontSize: 10, color: "#7c6af7", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 },
  trendRow:  { display: "flex", gap: 6, alignItems: "center", padding: "4px 0", borderBottom: "1px solid #1a1a28", fontSize: 12 },
  zonRow:    { display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: "1px solid #1a1a28", fontSize: 13 },
  kbanaRow:  { display: "flex", gap: 8, alignItems: "center", padding: "4px 0", fontSize: 12 },
  prevInfo:  { background: "#13131c", border: "1px solid #1e1e2e", borderRadius: 8, padding: "10px 16px", fontSize: 12, color: "#666" },
};
