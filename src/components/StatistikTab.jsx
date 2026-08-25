import { useState, useMemo } from "react";
import { useDeviations } from "../hooks/useDeviations.js";
import { useRader } from "../hooks/useRader.js";
import { useSettings } from "../hooks/useSettings.js";
import { forEachOrsak } from "../lib/orsak.js";
import { fmtKr, fmtTimmar, promille, fmtProm, goalColor, daysAgoISO } from "../lib/dates.js";
import { ORSAK_ANSVAR } from "../lib/causes.js";
import { totalRader } from "../lib/rader.js";

// Tomt fält ("" = orört) faller tillbaka på nuvarande värde; annars parseFloat.
// `|| fallback` hade inte fungerat här — 0 är falsy, så man hade aldrig kunnat
// spara ett fält som 0.
function resolveNum(draft, fallback) {
  if (draft === "") return fallback;
  const n = parseFloat(draft);
  return Number.isNaN(n) ? fallback : n;
}

function KpiCard({ label, value, sub, color, borderColor }) {
  return (
    <div style={{ ...s.kpi, borderColor: borderColor || "#1e1e2e" }}>
      <div style={{ ...s.kpiValue, color: color || "#f0f0f5" }}>{value}</div>
      <div style={s.kpiLabel}>{label}</div>
      {sub && <div style={s.kpiSub}>{sub}</div>}
    </div>
  );
}

export function StatistikTab() {
  const [filterDatum,  setFilterDatum]  = useState("");
  // Default: senaste 90 dagarna, så gammal historik inte skymmer aktuell statistik.
  // Rensa fältet (eller sätt ett tidigare datum) för att se längre bak.
  const [fromDate,     setFromDate]     = useState(() => daysAgoISO(90));
  const [toDate,       setToDate]       = useState("");
  const [filterZon,    setFilterZon]    = useState("");

  // Fetch matches exactly what's selected above — an exact date overrides
  // the range, same precedence as the client-side filter further down —
  // instead of always pulling the whole (unboundedly growing) table and
  // discarding most of it here.
  const { deviations, loading } = useDeviations(
    filterDatum ? { datum: filterDatum } : { fromDate, toDate }
  );
  const { getRaderForDatum }    = useRader();
  const { settings, save }      = useSettings();
  const [editSettings, setEditSettings] = useState(false);
  const [draftGoal,    setDraftGoal]    = useState("");
  const [draftCost,    setDraftCost]    = useState("");
  const [draftTime,    setDraftTime]    = useState("");

  const allaDatum = useMemo(
    () => [...new Set(deviations.map((d) => String(d.datum).slice(0, 10)))].sort().reverse(),
    [deviations]
  );

  const filtered = useMemo(() => {
    let r = deviations;
    if (filterDatum) {
      r = r.filter((d) => String(d.datum).slice(0, 10) === filterDatum);
    } else {
      if (fromDate) r = r.filter((d) => String(d.datum).slice(0, 10) >= fromDate);
      if (toDate)   r = r.filter((d) => String(d.datum).slice(0, 10) <= toDate);
    }
    if (filterZon) r = r.filter((d) => d.zon === filterZon);
    return r;
  }, [deviations, filterDatum, fromDate, toDate, filterZon]);

  const goal     = parseFloat(settings.goal)     || 2.0;
  const cost     = parseFloat(settings.cost)     || 63;
  const timePMin = parseFloat(settings.time_min) || 13;

  const totalAvv = useMemo(() => filtered.reduce((s, r) => s + (r.count || 0), 0), [filtered]);
  const totalVnr = filtered.length;
  const dates    = useMemo(() => [...new Set(filtered.map((r) => r.datum))].sort(), [filtered]);

  const totalRader = useMemo(() => {
    let z1 = 0, z2 = 0, z3 = 0, tot = 0;
    for (const d of dates) {
      const rd = getRaderForDatum(d);
      z1 += rd.zon1 || 0; z2 += rd.zon2 || 0; z3 += rd.zon3 || 0;
      tot += totalRader(rd);
    }
    return { z1, z2, z3, tot };
  }, [dates, getRaderForDatum]);

  const avvPerZon = useMemo(() => {
    const m = {};
    filtered.forEach((r) => { const z = r.zon || "?"; m[z] = (m[z] || 0) + (r.count || 0); });
    return m;
  }, [filtered]);

  const orsakTotals = useMemo(() => {
    const m = {};
    forEachOrsak(filtered, (o, n) => { m[o] = (m[o] || 0) + n; });
    return m;
  }, [filtered]);

  const orsakEntries = useMemo(
    () => Object.entries(orsakTotals).sort((a, b) => b[1] - a[1]),
    [orsakTotals]
  );
  const maxOrsak = orsakEntries[0]?.[1] || 1;

  // Top VNR (återkommande)
  const topVnr = useMemo(() => {
    const m = {};
    filtered.forEach((r) => { m[r.vnr] = (m[r.vnr] || 0) + (r.count || 0); });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [filtered]);

  // Per K-bana
  const kbanaRank = useMemo(() => {
    const m = {};
    filtered.forEach((r) => { if (r.kbana) m[r.kbana] = (m[r.kbana] || 0) + (r.count || 0); });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [filtered]);
  const maxKbana = kbanaRank[0]?.[1] || 1;

  // Dag-för-dag
  const dagTrend = useMemo(() => dates.map((datum) => {
    const avv = filtered.filter((r) => r.datum === datum).reduce((s, r) => s + r.count, 0);
    const rd  = getRaderForDatum(datum);
    const tot = totalRader(rd);
    return { datum, avv, rader: tot, prom: promille(avv, tot) };
  }).reverse(), [dates, filtered, getRaderForDatum]);

  const promTot = promille(totalAvv, totalRader.tot);
  const pColor  = goalColor(promTot, goal);

  function resetDrafts() {
    setDraftGoal(""); setDraftCost(""); setDraftTime("");
  }

  function toggleSettings() {
    resetDrafts();
    setEditSettings((v) => !v);
  }

  async function saveSettings() {
    await save({
      goal:     resolveNum(draftGoal, settings.goal),
      cost:     resolveNum(draftCost, settings.cost),
      time_min: resolveNum(draftTime, settings.time_min),
    });
    resetDrafts();
    setEditSettings(false);
  }

  if (loading) return <div style={s.status}>Laddar statistik…</div>;

  return (
    <div style={s.wrap}>
      {/* Filter */}
      <div style={s.filterRow}>
        <select value={filterDatum} onChange={(e) => setFilterDatum(e.target.value)} style={s.sel}>
          <option value="">Alla datum</option>
          {allaDatum.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <span style={s.dim}>Från:</span>
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ ...s.dateIn, opacity: filterDatum ? 0.4 : 1 }} disabled={!!filterDatum} />
        <span style={s.dim}>Till:</span>
        <input type="date" value={toDate}   onChange={(e) => setToDate(e.target.value)}   style={{ ...s.dateIn, opacity: filterDatum ? 0.4 : 1 }} disabled={!!filterDatum} />
        <select value={filterZon} onChange={(e) => setFilterZon(e.target.value)} style={s.sel}>
          <option value="">Alla zoner</option>
          <option value="1">Zon 1</option><option value="2">Zon 2</option><option value="3">Zon 3</option>
        </select>
        <button onClick={toggleSettings} style={s.settBtn}>⚙ Inställningar</button>
      </div>

      {/* Inställningar */}
      {editSettings && (
        <div style={s.settPanel}>
          <div style={s.settRow}>
            <span style={s.dim}>Mål ‰</span>
            <input type="number" step="0.1" defaultValue={settings.goal}     onChange={(e) => setDraftGoal(e.target.value)} style={s.numIn} />
            <span style={s.dim}>Kr/avv</span>
            <input type="number"            defaultValue={settings.cost}     onChange={(e) => setDraftCost(e.target.value)} style={s.numIn} />
            <span style={s.dim}>Min/avv</span>
            <input type="number"            defaultValue={settings.time_min} onChange={(e) => setDraftTime(e.target.value)} style={s.numIn} />
            <button onClick={saveSettings} style={s.saveBtn}>Spara</button>
            <button onClick={toggleSettings} style={s.cancBtn}>Avbryt</button>
          </div>
          <div style={{ fontSize: 11, color: "#555", marginTop: 6 }}>
            Mål {goal.toFixed(1)} ‰ · {cost} kr/avvikelse · {timePMin} min/avvikelse
          </div>
        </div>
      )}

      {/* Huvud-KPI */}
      <div style={s.kpiGrid}>
        <KpiCard label="Avvikelser" value={totalAvv.toLocaleString("sv-SE")} color="#f97316" />
        <KpiCard label="Unika VNR"  value={totalVnr.toLocaleString("sv-SE")} color="#7c6af7" />
        <KpiCard label="Dagar"      value={dates.length} color="#60a5fa" />
        <KpiCard
          label="Snitt / dag"
          value={dates.length ? Math.round(totalAvv / dates.length) : "—"}
          color="#4ade80"
        />
        <KpiCard
          label="Avvikelsegrad"
          value={fmtProm(promTot)}
          sub={`Mål: ${goal.toFixed(1)} ‰`}
          color={pColor}
          borderColor={pColor + "60"}
        />
        <KpiCard label="Kostnad"     value={fmtKr(totalAvv * cost)}     sub={`${cost} kr/avv`}     color="#fbbf24" />
        <KpiCard label="Nedlagd tid" value={fmtTimmar(totalAvv * timePMin)} sub={`${timePMin} min/avv`} color="#f97316" />
      </div>

      {/* Zon-promille */}
      <div style={{ ...s.kpiGrid, gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 20 }}>
        {["1","2","3"].map((z) => {
          const avv = avvPerZon[z] || 0;
          const rad = z === "1" ? totalRader.z1 : z === "2" ? totalRader.z2 : totalRader.z3;
          const p   = promille(avv, rad);
          return (
            <KpiCard
              key={z}
              label={`Zon ${z} promille`}
              value={fmtProm(p)}
              sub={`${avv} avv / ${rad.toLocaleString("sv-SE")} rader`}
              color={goalColor(p, goal)}
            />
          );
        })}
      </div>

      <div style={s.twoCol}>
        {/* Per orsak */}
        <div style={s.panel}>
          <div style={s.ph}>Avvikelser per orsak</div>
          {orsakEntries.length === 0 && <div style={s.dim}>Inga data</div>}
          {orsakEntries.map(([orsak, antal]) => (
            <div key={orsak} style={s.orsakRow}>
              <div>
                <div style={s.orsakName}>{orsak}</div>
                {ORSAK_ANSVAR[orsak] && ORSAK_ANSVAR[orsak] !== "—" &&
                  <div style={s.orsakAnsvar}>→ {ORSAK_ANSVAR[orsak]}</div>}
              </div>
              <div style={s.barWrap}>
                <div style={{ ...s.bar, width: `${antal / maxOrsak * 100}%` }} />
              </div>
              <span style={s.mono}>{antal}</span>
              <span style={s.dim}>{totalAvv > 0 ? `${Math.round(antal / totalAvv * 100)}%` : ""}</span>
            </div>
          ))}
        </div>

        {/* Dag-för-dag */}
        <div style={s.panel}>
          <div style={s.ph}>Dag-för-dag ({dagTrend.length} dagar)</div>
          <div style={{ maxHeight: 300, overflowY: "auto" }}>
            <div style={s.trendHdr}><span>Datum</span><span>Avv</span><span>Rader</span><span>Promille</span></div>
            {dagTrend.map(({ datum, avv, rader: rd, prom }) => (
              <div key={datum} style={s.trendRow}>
                <span style={{ fontFamily: "monospace", color: "#8a8a9a" }}>{datum}</span>
                <span style={s.mono}>{avv}</span>
                <span style={s.mono}>{rd ? rd.toLocaleString("sv-SE") : "—"}</span>
                <span style={{ ...s.mono, color: goalColor(prom, goal), fontWeight: 700 }}>{fmtProm(prom)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={s.twoCol}>
        {/* Top VNR */}
        <div style={s.panel}>
          <div style={s.ph}>Topp VNR (återkommande)</div>
          {topVnr.length === 0 && <div style={s.dim}>Inga data</div>}
          {topVnr.map(([vnr, count], i) => (
            <div key={vnr} style={s.trendRow}>
              <span style={{ ...s.mono, color: i === 0 ? "#f97316" : "#8a8a9a", minWidth: 20 }}>{i + 1}.</span>
              <span style={{ ...s.mono, flex: 1 }}>{vnr}</span>
              <span style={{ ...s.mono, color: "#7c6af7" }}>×{count}</span>
            </div>
          ))}
        </div>

        {/* Per K-bana */}
        <div style={s.panel}>
          <div style={s.ph}>Per K-bana</div>
          {kbanaRank.length === 0 && <div style={s.dim}>Inga data</div>}
          {kbanaRank.map(([kbana, antal]) => (
            <div key={kbana} style={s.orsakRow}>
              <span style={{ ...s.mono, color: "#f97316" }}>{kbana}</span>
              <div style={s.barWrap}>
                <div style={{ ...s.bar, width: `${antal / maxKbana * 100}%`, background: "#f97316" }} />
              </div>
              <span style={s.mono}>{antal}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const s = {
  wrap:       { padding: "16px 20px", fontFamily: "system-ui, sans-serif", background: "#0a0a0f", minHeight: "100%", color: "#f0f0f5" },
  status:     { padding: 40, textAlign: "center", color: "#888" },
  filterRow:  { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 16 },
  dim:        { fontSize: 11, color: "#666" },
  dateIn:     { background: "#13131c", border: "1px solid #2a2a3a", color: "#f0f0f5", borderRadius: 6, padding: "6px 10px", fontSize: 13, outline: "none" },
  sel:        { background: "#13131c", border: "1px solid #2a2a3a", color: "#f0f0f5", borderRadius: 6, padding: "6px 10px", fontSize: 12, cursor: "pointer" },
  settBtn:    { marginLeft: "auto", background: "#16162a", border: "1px solid #2a2a3a", color: "#888", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" },
  settPanel:  { background: "#13131c", border: "1px solid #2a2a3a", borderRadius: 8, padding: "12px 16px", marginBottom: 16 },
  settRow:    { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  numIn:      { width: 72, background: "#0f0f18", border: "1px solid #2a2a3a", color: "#f0f0f5", borderRadius: 6, padding: "5px 8px", fontSize: 13, outline: "none" },
  saveBtn:    { background: "#7c6af7", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" },
  cancBtn:    { background: "#1e1e2e", color: "#888", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" },
  kpiGrid:    { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 16 },
  kpi:        { background: "#13131c", border: "1px solid", borderRadius: 10, padding: "14px 16px" },
  kpiValue:   { fontSize: 24, fontWeight: 800, fontFamily: "monospace", marginBottom: 4 },
  kpiLabel:   { fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 1 },
  kpiSub:     { fontSize: 11, color: "#444", marginTop: 3 },
  twoCol:     { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 },
  panel:      { background: "#13131c", border: "1px solid #1e1e2e", borderRadius: 8, padding: "14px 16px" },
  ph:         { fontSize: 10, color: "#7c6af7", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 },
  orsakRow:   { display: "grid", gridTemplateColumns: "1fr 80px 36px 36px", gap: 6, alignItems: "center", marginBottom: 8 },
  orsakName:  { fontSize: 12, color: "#c0c0d0" },
  orsakAnsvar:{ fontSize: 10, color: "#60a5fa" },
  barWrap:    { background: "#1e1e2e", borderRadius: 3, height: 6, overflow: "hidden" },
  bar:        { height: "100%", background: "#7c6af7", borderRadius: 3, transition: "width .3s" },
  mono:       { fontFamily: "monospace", fontSize: 12, color: "#f0f0f5", textAlign: "right" },
  trendHdr:   { display: "grid", gridTemplateColumns: "1fr 44px 80px 76px", gap: 6, fontSize: 10, color: "#555", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, paddingBottom: 6, borderBottom: "1px solid #1e1e2e", marginBottom: 4 },
  trendRow:   { display: "grid", gridTemplateColumns: "1fr 44px 80px 76px", gap: 6, fontSize: 12, padding: "3px 0", alignItems: "center" },
};
