import { useState, useMemo } from "react";
import { useDeviations } from "../hooks/useDeviations.js";
import { useRader } from "../hooks/useRader.js";
import { useSettings } from "../hooks/useSettings.js";
import { ORSAK_ANSVAR } from "../lib/causes.js";

// ─── Hjälpare ────────────────────────────────────────────────────────────────

function promille(avv, rad) { return rad > 0 ? avv / rad * 1000 : null; }
function fmtProm(v) { return v === null ? "—" : v.toFixed(2) + " ‰"; }

function goalColor(p, goal) {
  if (p === null) return "#60a5fa";
  if (p <= goal) return "#4ade80";
  if (p <= goal * 1.25) return "#fbbf24";
  return "#f87171";
}

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}
function isoOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── Morgonbriefing ──────────────────────────────────────────────────────────

function calcBriefing(devs) {
  const tips = [];

  // 1. Peak-timme per K-bana
  const hourKbana = {};
  for (const r of devs) {
    if (!r.hours?.length || !r.kbana) continue;
    for (const h of r.hours) {
      const k = `${h}|${r.kbana}`;
      hourKbana[k] = (hourKbana[k] || 0) + 1;
    }
  }
  const topCombo = Object.entries(hourKbana).sort((a, b) => b[1] - a[1]).slice(0, 2);
  for (const [key, count] of topCombo) {
    if (count < 2) continue;
    const [h, kbana] = key.split("|");
    const totalInKbana = devs.filter((r) => r.kbana === kbana).reduce((s, r) => s + r.count, 0);
    const locs = [...new Set(
      devs.filter((r) => r.kbana === kbana && r.hours?.includes(+h)).flatMap((r) => r.locations || [])
    )];
    tips.push({
      typ: "tid",
      text: `Kl ${h}–${+h + 1}: håll extra koll på ${kbana}${locs[0] ? ` (${locs[0]})` : ""} — ${count} av ${totalInKbana} avv i den timmen`,
    });
  }

  // 2. Upprepad "Försent påfylld"
  const pfMap = {};
  for (const r of devs) {
    if (r.orsak !== "Försent påfylld") continue;
    if (!pfMap[r.vnr]) pfMap[r.vnr] = { days: 0, locs: new Set() };
    pfMap[r.vnr].days++;
    (r.locations || []).forEach((l) => pfMap[r.vnr].locs.add(l));
  }
  for (const [vnr, v] of Object.entries(pfMap).sort((a, b) => b[1].days - a[1].days)) {
    if (v.days < 2) continue;
    const loc = [...v.locs][0] || "";
    tips.push({
      typ: "pf",
      text: `VNR ${vnr}${loc ? ` på ${loc}` : ""}: sen påfyllning ${v.days} ggr — se över PF-punkt eller beställningspunkt`,
    });
  }

  // 3. Upprepad "Saldofel"
  const sfMap = {};
  for (const r of devs) {
    if (r.orsak !== "Saldofel") continue;
    if (!sfMap[r.vnr]) sfMap[r.vnr] = { days: 0, locs: new Set() };
    sfMap[r.vnr].days++;
    (r.locations || []).forEach((l) => sfMap[r.vnr].locs.add(l));
  }
  for (const [vnr, v] of Object.entries(sfMap).sort((a, b) => b[1].days - a[1].days)) {
    if (v.days < 2) continue;
    const loc = [...v.locs][0] || "";
    tips.push({
      typ: "saldo",
      text: `VNR ${vnr}${loc ? ` på ${loc}` : ""}: saldofel ${v.days} ggr — inventera platsen`,
    });
  }

  // 4. Kontrollscanning flera dagar i rad
  const ktrlMap = {};
  for (const r of devs) {
    if (!r.kontroll_scans || r.kontroll_scans === 0) continue;
    if (!ktrlMap[r.vnr]) ktrlMap[r.vnr] = { days: 0, locs: new Set() };
    ktrlMap[r.vnr].days++;
    (r.locations || []).forEach((l) => ktrlMap[r.vnr].locs.add(l));
  }
  for (const [vnr, v] of Object.entries(ktrlMap).sort((a, b) => b[1].days - a[1].days)) {
    if (v.days < 2) continue;
    const loc = [...v.locs][0] || "";
    tips.push({
      typ: "kontroll",
      text: `VNR ${vnr}${loc ? ` på ${loc}` : ""}: kontrollscanning ${v.days} dagar — undersök plockinstruktionen`,
    });
  }

  // 5. Hög andel kritiskt (<30 min före avgång)
  const kritiska = devs.filter((r) => r.min_fore_avgang !== null && r.min_fore_avgang < 30);
  const totKrit  = kritiska.reduce((s, r) => s + r.count, 0);
  const totAvv   = devs.reduce((s, r) => s + r.count, 0);
  if (totAvv > 0 && totKrit / totAvv > 0.15) {
    tips.push({
      typ: "tid",
      text: `${totKrit} avv under 30 min före avgång (${Math.round(totKrit / totAvv * 100)}%) — prioritera plockordning tidigt`,
    });
  }

  return tips.slice(0, 8);
}

// ─── Streaks ──────────────────────────────────────────────────────────────────

function calcStreaks(dayMap, goal, sortedDates) {
  let maxOver = 0, maxUnder = 0, curOver = 0, curUnder = 0;
  for (const d of sortedDates) {
    const p = promille(dayMap[d].avv, dayMap[d].rader);
    if (p === null) continue;
    if (p > goal) { curOver++; curUnder = 0; }
    else           { curUnder++; curOver = 0; }
    if (curOver  > maxOver)  maxOver  = curOver;
    if (curUnder > maxUnder) maxUnder = curUnder;
  }
  let overStreak = 0, underStreak = 0;
  for (let i = sortedDates.length - 1; i >= 0; i--) {
    const p = promille(dayMap[sortedDates[i]].avv, dayMap[sortedDates[i]].rader);
    if (p === null) break;
    if (i === sortedDates.length - 1) {
      if (p > goal) overStreak = 1; else underStreak = 1;
    } else {
      const pp = promille(dayMap[sortedDates[i + 1]].avv, dayMap[sortedDates[i + 1]].rader);
      if (pp === null) break;
      if (p > goal && pp > goal) overStreak++;
      else if (p <= goal && pp <= goal) underStreak++;
      else break;
    }
  }
  return { overStreak, underStreak, maxOver, maxUnder };
}

// ─── Peak-timme ───────────────────────────────────────────────────────────────

function calcPeakHour(devs) {
  const hc = Array(24).fill(0);
  for (const r of devs) {
    if (!r.hours?.length) continue;
    for (const h of r.hours) if (h >= 0 && h < 24) hc[h]++;
  }
  const max = Math.max(...hc);
  if (max === 0) return null;
  const ph = hc.indexOf(max);
  return { hour: ph, nextHour: (ph + 1) % 24, count: max, showRange: hc[(ph + 1) % 24] >= max * 0.75 };
}

// ─── Återkommande VNR ─────────────────────────────────────────────────────────

function calcRecurring(devs) {
  const m = {};
  for (const r of devs) {
    if (!m[r.vnr]) m[r.vnr] = new Set();
    m[r.vnr].add(r.datum);
  }
  return Object.entries(m)
    .filter(([, d]) => d.size >= 2)
    .map(([vnr, dates]) => {
      const recs = devs.filter((r) => r.vnr === vnr);
      return {
        vnr, days: dates.size,
        totalCount: recs.reduce((s, r) => s + r.count, 0),
        locs:  [...new Set(recs.flatMap((r) => r.locations || []))],
        kbana: recs.find((r) => r.kbana)?.kbana || "",
      };
    })
    .sort((a, b) => b.days - a.days || b.totalCount - a.totalCount)
    .slice(0, 12);
}

// ─── PERIOD-FILTER CONFIG ─────────────────────────────────────────────────────

const PERIODS = [
  { id: "igår",  label: "Igår" },
  { id: "7",     label: "7 dagar" },
  { id: "14",    label: "14 dagar" },
  { id: "30",    label: "30 dagar" },
  { id: "all",   label: "All historik" },
];

function filterByPeriod(devs, period) {
  if (period === "all")  return devs;
  const yesterday = isoOffset(-1);
  if (period === "igår") return devs.filter((r) => r.datum === yesterday);
  const cutoff = isoOffset(-parseInt(period));
  return devs.filter((r) => r.datum >= cutoff);
}

// ─── TYP → stil ──────────────────────────────────────────────────────────────

const TYP_STYLE = {
  tid:      { border: "#7c6af7", label: "Tid",      lc: "#7c6af7" },
  pf:       { border: "#f97316", label: "Påfyllnad", lc: "#f97316" },
  saldo:    { border: "#f87171", label: "Saldo",     lc: "#f87171" },
  kontroll: { border: "#fbbf24", label: "Kontroll",  lc: "#fbbf24" },
};

const PRIO_COLOR = { "hög": "#f87171", "medel": "#fbbf24" };

// ─── AnalysTab ────────────────────────────────────────────────────────────────

export function AnalysTab() {
  const [period, setPeriod]       = useState("7");
  const { deviations, loading }   = useDeviations();
  const { getRaderForDatum }      = useRader();
  const { settings }              = useSettings();
  const goal = parseFloat(settings.goal) || 2.0;

  // Alla datum (för streaks — alltid all data)
  const allDates = useMemo(
    () => [...new Set(deviations.map((r) => r.datum))].sort(),
    [deviations]
  );
  const allDayMap = useMemo(() => {
    const m = {};
    for (const d of allDates) {
      const avv = deviations.filter((r) => r.datum === d).reduce((s, r) => s + r.count, 0);
      const rd  = getRaderForDatum(d);
      m[d] = { avv, rader: (rd.zon1 || 0) + (rd.zon2 || 0) + (rd.zon3 || 0) };
    }
    return m;
  }, [deviations, allDates, getRaderForDatum]);

  // Filtrerad data för briefing + analys
  const filtered = useMemo(() => filterByPeriod(deviations, period), [deviations, period]);
  const filtDates = useMemo(() => [...new Set(filtered.map((r) => r.datum))].sort(), [filtered]);
  const filtDayMap = useMemo(() => {
    const m = {};
    for (const d of filtDates) {
      const avv = filtered.filter((r) => r.datum === d).reduce((s, r) => s + r.count, 0);
      const rd  = getRaderForDatum(d);
      m[d] = { avv, rader: (rd.zon1 || 0) + (rd.zon2 || 0) + (rd.zon3 || 0) };
    }
    return m;
  }, [filtered, filtDates, getRaderForDatum]);

  const briefing  = useMemo(() => calcBriefing(filtered), [filtered]);
  const peak      = useMemo(() => calcPeakHour(filtered), [filtered]);
  const recurring = useMemo(() => calcRecurring(filtered), [filtered]);
  const { overStreak, underStreak, maxOver, maxUnder } = useMemo(
    () => calcStreaks(allDayMap, goal, allDates), [allDayMap, goal, allDates]
  );
  const orsakCount = useMemo(() => {
    const m = {};
    filtered.forEach((r) => { m[r.orsak || "Okänd"] = (m[r.orsak || "Okänd"] || 0) + r.count; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [filtered]);
  const totAvv = filtered.reduce((s, r) => s + r.count, 0);

  if (loading) return <div style={s.status}>Laddar analys…</div>;
  if (deviations.length === 0) return <div style={s.status}>Inga avvikelser att analysera ännu.</div>;

  const periodLabel = PERIODS.find((p) => p.id === period)?.label ?? "";

  return (
    <div style={s.wrap}>

      {/* ── Periodväljare ───────────────────────────────────── */}
      <div style={s.periodRow}>
        {PERIODS.map((p) => (
          <button
            key={p.id}
            style={{ ...s.periodBtn, ...(period === p.id ? s.periodActive : {}) }}
            onClick={() => setPeriod(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* ── Morgonbriefing ──────────────────────────────────── */}
      <div style={s.sectionHdr}>Morgonbriefing — {periodLabel}</div>
      {briefing.length === 0 ? (
        <div style={{ ...s.panel, marginBottom: 20, color: "#444", fontSize: 13 }}>
          Inga mönster att lyfta för den valda perioden.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
          {briefing.map((tip, i) => {
            const ts = TYP_STYLE[tip.typ] || TYP_STYLE.tid;
            return (
              <div key={i} style={{ ...s.briefRow, borderLeftColor: ts.border }}>
                <span style={{ ...s.typTag, color: ts.lc, borderColor: ts.lc + "40", background: ts.lc + "12" }}>
                  {ts.label}
                </span>
                <span style={s.briefText}>{tip.text}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Trend (all historik) ────────────────────────────── */}
      <div style={s.sectionHdr}>Trend — all historik</div>
      <div style={s.kpiGrid}>
        {underStreak > 0 && (
          <div style={{ ...s.kpi, borderColor: "#4ade8060" }}>
            <div style={{ ...s.kpiVal, color: "#4ade80" }}>{underStreak}</div>
            <div style={s.kpiLbl}>Dagar i rad under mål</div>
          </div>
        )}
        {overStreak > 0 && (
          <div style={{ ...s.kpi, borderColor: "#f8717160" }}>
            <div style={{ ...s.kpiVal, color: "#f87171" }}>{overStreak}</div>
            <div style={s.kpiLbl}>Dagar i rad ÖVER mål</div>
          </div>
        )}
        <div style={s.kpi}>
          <div style={{ ...s.kpiVal, color: "#4ade80" }}>{maxUnder}</div>
          <div style={s.kpiLbl}>Längsta period under mål</div>
        </div>
        <div style={s.kpi}>
          <div style={{ ...s.kpiVal, color: "#f87171" }}>{maxOver}</div>
          <div style={s.kpiLbl}>Längsta period över mål</div>
        </div>
        {peak && (
          <div style={s.kpi}>
            <div style={{ ...s.kpiVal, color: "#7c6af7" }}>
              {peak.showRange ? `${peak.hour}–${peak.nextHour}` : String(peak.hour)}
            </div>
            <div style={s.kpiLbl}>Peak-timme</div>
            <div style={s.kpiSub}>{peak.count} avv i {periodLabel.toLowerCase()}</div>
          </div>
        )}
      </div>

      {/* ── Återkommande VNR + Orsaker ──────────────────────── */}
      <div style={s.sectionHdr}>{periodLabel} — detalj</div>
      <div style={s.twoCol}>
        <div style={s.panel}>
          <div style={s.ph}>Återkommande VNR (≥ 2 datum)</div>
          {recurring.length === 0
            ? <div style={s.dim}>Inga återkommande i perioden.</div>
            : recurring.map(({ vnr, days, totalCount, locs, kbana }) => (
              <div key={vnr} style={s.recurRow}>
                <div>
                  <span style={s.vnrMono}>{vnr}</span>
                  {kbana && <span style={s.kbanaTag}>{kbana}</span>}
                  {locs[0] && <span style={s.dim}> {locs[0]}</span>}
                </div>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <span style={s.dim}>{days} dagar</span>
                  <span style={{ fontFamily: "monospace", fontWeight: 700,
                    color: days >= 5 ? "#f87171" : days >= 3 ? "#fbbf24" : "#f0f0f5" }}>
                    ×{totalCount}
                  </span>
                </div>
              </div>
            ))
          }
        </div>

        <div style={s.panel}>
          <div style={s.ph}>Rotorsaksfördelning</div>
          {orsakCount.map(([orsak, count]) => {
            const pct    = totAvv > 0 ? Math.round(count / totAvv * 100) : 0;
            const ansvar = ORSAK_ANSVAR[orsak];
            return (
              <div key={orsak} style={s.orsakRow}>
                <div>
                  <div style={{ fontSize: 12, color: "#c0c0d0" }}>{orsak}</div>
                  {ansvar && ansvar !== "—" && <div style={{ fontSize: 10, color: "#60a5fa" }}>→ {ansvar}</div>}
                </div>
                <div style={s.barWrap}><div style={{ ...s.bar, width: `${pct}%` }} /></div>
                <span style={{ fontFamily: "monospace", fontSize: 12, color: "#f0f0f5", minWidth: 28, textAlign: "right" }}>{count}</span>
                <span style={{ fontSize: 11, color: "#555", minWidth: 32, textAlign: "right" }}>{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Bästa / sämsta dagar ────────────────────────────── */}
      <div style={s.twoCol}>
        <div style={s.panel}>
          <div style={s.ph}>Bästa dagar (lägst promille)</div>
          {filtDates
            .map((d) => ({ datum: d, ...filtDayMap[d], prom: promille(filtDayMap[d].avv, filtDayMap[d].rader) }))
            .filter((d) => d.prom !== null)
            .sort((a, b) => a.prom - b.prom)
            .slice(0, 5)
            .map(({ datum, avv, prom }) => (
              <div key={datum} style={s.trendRow}>
                <span style={{ fontFamily: "monospace", color: "#8a8a9a", flex: 1 }}>{datum}</span>
                <span style={{ fontFamily: "monospace", color: "#f0f0f5", minWidth: 32, textAlign: "right" }}>{avv}</span>
                <span style={{ fontFamily: "monospace", color: "#4ade80", fontWeight: 700, minWidth: 72, textAlign: "right" }}>{fmtProm(prom)}</span>
              </div>
            ))}
        </div>
        <div style={s.panel}>
          <div style={s.ph}>Sämsta dagar (högst promille)</div>
          {filtDates
            .map((d) => ({ datum: d, ...filtDayMap[d], prom: promille(filtDayMap[d].avv, filtDayMap[d].rader) }))
            .filter((d) => d.prom !== null)
            .sort((a, b) => b.prom - a.prom)
            .slice(0, 5)
            .map(({ datum, avv, prom }) => (
              <div key={datum} style={s.trendRow}>
                <span style={{ fontFamily: "monospace", color: "#8a8a9a", flex: 1 }}>{datum}</span>
                <span style={{ fontFamily: "monospace", color: "#f0f0f5", minWidth: 32, textAlign: "right" }}>{avv}</span>
                <span style={{ fontFamily: "monospace", color: goalColor(prom, goal), fontWeight: 700, minWidth: 72, textAlign: "right" }}>{fmtProm(prom)}</span>
              </div>
            ))}
        </div>
      </div>

    </div>
  );
}

// ─── Stilar ───────────────────────────────────────────────────────────────────

const s = {
  wrap:        { padding: "16px 20px", fontFamily: "system-ui, sans-serif", background: "#0a0a0f", minHeight: "100%", color: "#f0f0f5" },
  status:      { padding: 40, textAlign: "center", color: "#888" },
  periodRow:   { display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" },
  periodBtn:   { background: "#13131c", border: "1px solid #1e1e2e", borderRadius: 20, padding: "5px 14px", fontSize: 12, color: "#666", cursor: "pointer", fontFamily: "inherit" },
  periodActive:{ background: "#16162a", border: "1px solid #7c6af7", color: "#7c6af7", fontWeight: 700 },
  sectionHdr:  { fontSize: 10, color: "#7c6af7", fontWeight: 700, textTransform: "uppercase", letterSpacing: 2, marginBottom: 10, marginTop: 4 },
  briefRow:    { display: "flex", alignItems: "flex-start", gap: 10, background: "#13131c", border: "1px solid #1e1e2e", borderLeft: "3px solid", borderRadius: "0 6px 6px 0", padding: "10px 14px" },
  briefText:   { fontSize: 13, color: "#d0d0e0", lineHeight: 1.5 },
  typTag:      { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, border: "1px solid", borderRadius: 4, padding: "2px 7px", whiteSpace: "nowrap", marginTop: 1 },
  kpiGrid:     { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 20 },
  kpi:         { background: "#13131c", border: "1px solid #1e1e2e", borderRadius: 10, padding: "14px 16px" },
  kpiVal:      { fontSize: 28, fontWeight: 800, fontFamily: "monospace", marginBottom: 4 },
  kpiLbl:      { fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 1 },
  kpiSub:      { fontSize: 11, color: "#444", marginTop: 3 },
  twoCol:      { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 },
  panel:       { background: "#13131c", border: "1px solid #1e1e2e", borderRadius: 8, padding: "14px 16px" },
  ph:          { fontSize: 10, color: "#7c6af7", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 },
  dim:         { fontSize: 11, color: "#666" },
  recurRow:    { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #1a1a28" },
  vnrMono:     { fontFamily: "monospace", fontSize: 12, color: "#f0f0f5", marginRight: 8 },
  kbanaTag:    { background: "#2a1a0a", color: "#f97316", border: "1px solid #3a2a1a", borderRadius: 4, padding: "1px 6px", fontSize: 10, fontWeight: 700, fontFamily: "monospace" },
  orsakRow:    { display: "grid", gridTemplateColumns: "1fr 80px 32px 36px", gap: 6, alignItems: "center", marginBottom: 8 },
  barWrap:     { background: "#1e1e2e", borderRadius: 3, height: 6, overflow: "hidden" },
  bar:         { height: "100%", background: "#7c6af7", borderRadius: 3, transition: "width .3s" },
  trendRow:    { display: "flex", gap: 6, alignItems: "center", padding: "4px 0", borderBottom: "1px solid #1a1a28", fontSize: 12 },
};
