import { useMemo } from "react";
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

// Räknar ut nuvarande streak av dagar ÖVER resp UNDER mål (kalenderdag-baserat).
function calcStreaks(dayMap, goal, sortedDates) {
  let overStreak = 0, underStreak = 0;
  let maxOver = 0, maxUnder = 0;
  let curOver = 0, curUnder = 0;

  for (const d of sortedDates) {
    const { avv, rader } = dayMap[d];
    const p = promille(avv, rader);
    if (p === null) continue; // ingen rader-data — bryt inte streak
    if (p > goal) {
      curOver++;
      curUnder = 0;
    } else {
      curUnder++;
      curOver = 0;
    }
    if (curOver  > maxOver)  maxOver  = curOver;
    if (curUnder > maxUnder) maxUnder = curUnder;
  }
  // Nuvarande streak = sista dagarna i serien
  for (let i = sortedDates.length - 1; i >= 0; i--) {
    const d = sortedDates[i];
    const { avv, rader } = dayMap[d];
    const p = promille(avv, rader);
    if (p === null) break;
    if (p > goal) { overStreak++; break; }
    underStreak++;
  }
  // Räkna faktisk nuvarande streak korrekt (framåt från slutet)
  overStreak = 0; underStreak = 0;
  for (let i = sortedDates.length - 1; i >= 0; i--) {
    const d = sortedDates[i];
    const { avv, rader } = dayMap[d];
    const p = promille(avv, rader);
    if (p === null) break;
    if (i === sortedDates.length - 1) {
      if (p > goal) overStreak = 1;
      else underStreak = 1;
    } else {
      const prev = sortedDates[i + 1];
      const prevP = promille(dayMap[prev].avv, dayMap[prev].rader);
      if (prevP === null) break;
      if (p > goal && prevP > goal) overStreak++;
      else if (p <= goal && prevP <= goal) underStreak++;
      else break;
    }
  }
  return { overStreak, underStreak, maxOver, maxUnder };
}

// Peak-timme: hittar timintervall med flest avvikelser
function calcPeakHour(deviations) {
  const hourCount = Array(24).fill(0);
  for (const r of deviations) {
    if (!r.hours?.length) continue;
    for (const h of r.hours) {
      if (h >= 0 && h < 24) hourCount[h]++;
    }
  }
  const max = Math.max(...hourCount);
  if (max === 0) return null;
  const peakH = hourCount.indexOf(max);
  // Kolla om nästa timme är nästan lika hög (visa som intervall)
  const nextH = (peakH + 1) % 24;
  const showRange = hourCount[nextH] >= max * 0.75;
  return { hour: peakH, nextHour: nextH, count: max, showRange };
}

// Återkommande VNR: VNR som avviker på ≥2 olika datum
function calcRecurring(deviations) {
  const vnrDates = {};
  for (const r of deviations) {
    if (!vnrDates[r.vnr]) vnrDates[r.vnr] = new Set();
    vnrDates[r.vnr].add(r.datum);
  }
  return Object.entries(vnrDates)
    .filter(([, dates]) => dates.size >= 2)
    .map(([vnr, dates]) => {
      const recs = deviations.filter((r) => r.vnr === vnr);
      const totalCount = recs.reduce((s, r) => s + r.count, 0);
      const locs = [...new Set(recs.flatMap((r) => r.locations || []))];
      const kbana = recs.find((r) => r.kbana)?.kbana || "";
      const zon   = recs.find((r) => r.zon)?.zon || "?";
      return { vnr, dates: [...dates].sort(), days: dates.size, totalCount, locs, kbana, zon };
    })
    .sort((a, b) => b.days - a.days || b.totalCount - a.totalCount)
    .slice(0, 15);
}

// Åtgärdslista: rangordnade problem
function calcActions(deviations, dayMap, sortedDates, goal) {
  const actions = [];

  // 1. VNR med ≥3 avvikelsedatum
  const vnrDates = {};
  for (const r of deviations) {
    if (!vnrDates[r.vnr]) vnrDates[r.vnr] = { count: 0, days: new Set(), locs: new Set(), kbana: r.kbana || "" };
    vnrDates[r.vnr].count += r.count;
    vnrDates[r.vnr].days.add(r.datum);
    (r.locations || []).forEach((l) => vnrDates[r.vnr].locs.add(l));
  }
  for (const [vnr, v] of Object.entries(vnrDates)) {
    if (v.days.size >= 3) {
      actions.push({
        prio: "hög",
        titel: `VNR ${vnr} avviker upprepat`,
        detalj: `${v.days.size} dagar · ${v.count} avvikelser totalt`,
        plats: [...v.locs][0] || "",
        kbana: v.kbana,
        typ: "vnr",
      });
    }
  }

  // 2. Dagar långt över mål (promille > goal * 1.5)
  for (const d of sortedDates) {
    const { avv, rader } = dayMap[d];
    const p = promille(avv, rader);
    if (p !== null && p > goal * 1.5) {
      actions.push({
        prio: "hög",
        titel: `${d} — ${fmtProm(p)} (${Math.round(p / goal * 100 - 100)}% över mål)`,
        detalj: `${avv} avvikelser`,
        plats: "",
        kbana: "",
        typ: "dag",
      });
    }
  }

  // 3. K-banor med många avvikelser
  const kbanaCount = {};
  for (const r of deviations) {
    if (r.kbana) kbanaCount[r.kbana] = (kbanaCount[r.kbana] || 0) + r.count;
  }
  const kbanaTop = Object.entries(kbanaCount).sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [kbana, count] of kbanaTop) {
    if (count >= 5) {
      const locs = [...new Set(deviations.filter((r) => r.kbana === kbana).flatMap((r) => r.locations || []))];
      actions.push({
        prio: "medel",
        titel: `K-bana ${kbana}: ${count} avvikelser`,
        detalj: `Kontrollera lagerplatser: ${locs.slice(0, 3).join(", ")}`,
        plats: locs[0] || "",
        kbana,
        typ: "kbana",
      });
    }
  }

  // 4. Hög andel Okänd orsak
  const okand = deviations.filter((r) => !r.orsak || r.orsak === "Okänd").reduce((s, r) => s + r.count, 0);
  const totAvv = deviations.reduce((s, r) => s + r.count, 0);
  if (totAvv > 0 && okand / totAvv > 0.1) {
    actions.push({
      prio: "medel",
      titel: `${okand} avvikelser saknar orsak (${Math.round(okand / totAvv * 100)}%)`,
      detalj: "Klassificera i Historik-fliken för bättre statistik",
      plats: "", kbana: "", typ: "data",
    });
  }

  return actions
    .sort((a, b) => (a.prio === "hög" ? 0 : 1) - (b.prio === "hög" ? 0 : 1))
    .slice(0, 12);
}

// ─── AnalysTab ────────────────────────────────────────────────────────────────

const PRIO_COLOR = { "hög": "#f87171", "medel": "#fbbf24", "låg": "#60a5fa" };

export function AnalysTab() {
  const { deviations, loading } = useDeviations();
  const { getRaderForDatum }    = useRader();
  const { settings }            = useSettings();

  const goal = parseFloat(settings.goal) || 2.0;

  const sortedDates = useMemo(
    () => [...new Set(deviations.map((r) => r.datum))].sort(),
    [deviations]
  );

  const dayMap = useMemo(() => {
    const m = {};
    for (const d of sortedDates) {
      const avv = deviations.filter((r) => r.datum === d).reduce((s, r) => s + r.count, 0);
      const rd  = getRaderForDatum(d);
      m[d] = { avv, rader: (rd.zon1 || 0) + (rd.zon2 || 0) + (rd.zon3 || 0) };
    }
    return m;
  }, [deviations, sortedDates, getRaderForDatum]);

  const { overStreak, underStreak, maxOver, maxUnder } = useMemo(
    () => calcStreaks(dayMap, goal, sortedDates),
    [dayMap, goal, sortedDates]
  );

  const peak      = useMemo(() => calcPeakHour(deviations), [deviations]);
  const recurring = useMemo(() => calcRecurring(deviations), [deviations]);
  const actions   = useMemo(() => calcActions(deviations, dayMap, sortedDates, goal), [deviations, dayMap, sortedDates, goal]);

  // Orsakstrender — om en orsak dominerar kraftigt
  const orsakCount = useMemo(() => {
    const m = {};
    deviations.forEach((r) => { m[r.orsak || "Okänd"] = (m[r.orsak || "Okänd"] || 0) + r.count; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [deviations]);
  const totAvv = deviations.reduce((s, r) => s + r.count, 0);

  if (loading) return <div style={s.status}>Laddar analys…</div>;
  if (deviations.length === 0) return <div style={s.status}>Inga avvikelser att analysera ännu.</div>;

  return (
    <div style={s.wrap}>

      {/* ── Streaks ────────────────────────────────────────────── */}
      <div style={s.sectionHdr}>Trend</div>
      <div style={s.kpiGrid}>
        {underStreak > 0 && (
          <div style={{ ...s.kpi, borderColor: "#4ade8060" }}>
            <div style={{ ...s.kpiVal, color: "#4ade80" }}>{underStreak}</div>
            <div style={s.kpiLbl}>Dagar i rad under mål 🎯</div>
          </div>
        )}
        {overStreak > 0 && (
          <div style={{ ...s.kpi, borderColor: "#f8717160" }}>
            <div style={{ ...s.kpiVal, color: "#f87171" }}>{overStreak}</div>
            <div style={s.kpiLbl}>Dagar i rad ÖVER mål ⚠</div>
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
              {peak.showRange ? `${peak.hour}–${peak.nextHour}` : `${peak.hour}`}
            </div>
            <div style={s.kpiLbl}>Peak-timme (flest avvikelser)</div>
            <div style={s.kpiSub}>{peak.count} avvikelser under den timmen</div>
          </div>
        )}
      </div>

      {/* ── Åtgärdslista ─────────────────────────────────────── */}
      {actions.length > 0 && (
        <>
          <div style={s.sectionHdr}>Åtgärdslista</div>
          <div style={s.actionList}>
            {actions.map((a, i) => (
              <div key={i} style={{ ...s.actionRow, borderLeftColor: PRIO_COLOR[a.prio] }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: PRIO_COLOR[a.prio], textTransform: "uppercase", letterSpacing: 1 }}>{a.prio}</span>
                  <span style={s.actionTitel}>{a.titel}</span>
                  {a.kbana && <span style={s.kbanaTag}>{a.kbana}</span>}
                  {a.plats && <span style={s.platsTag}>{a.plats}</span>}
                </div>
                {a.detalj && <div style={s.actionDetalj}>{a.detalj}</div>}
              </div>
            ))}
          </div>
        </>
      )}

      <div style={s.twoCol}>
        {/* ── Återkommande VNR ─────────────────────────────────── */}
        <div style={s.panel}>
          <div style={s.ph}>Återkommande VNR (≥ 2 datum)</div>
          {recurring.length === 0 && <div style={s.dim}>Inga återkommande VNR i perioden.</div>}
          {recurring.map(({ vnr, days, totalCount, locs, kbana, zon }) => (
            <div key={vnr} style={s.recurRow}>
              <div>
                <span style={s.vnrMono}>{vnr}</span>
                {kbana && <span style={s.kbanaTag}>{kbana}</span>}
                {locs[0] && <span style={s.dim}> {locs[0]}</span>}
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span style={{ ...s.dim }}>{days} dagar</span>
                <span style={{ fontFamily: "monospace", color: days >= 5 ? "#f87171" : days >= 3 ? "#fbbf24" : "#f0f0f5", fontWeight: 700 }}>×{totalCount}</span>
              </div>
            </div>
          ))}
        </div>

        {/* ── Orsaks-trender ────────────────────────────────────── */}
        <div style={s.panel}>
          <div style={s.ph}>Rotorsaksfördelning</div>
          {orsakCount.map(([orsak, count]) => {
            const pct = totAvv > 0 ? Math.round(count / totAvv * 100) : 0;
            const ansvar = ORSAK_ANSVAR[orsak];
            return (
              <div key={orsak} style={s.orsakRow}>
                <div>
                  <div style={{ fontSize: 12, color: "#c0c0d0" }}>{orsak}</div>
                  {ansvar && ansvar !== "—" && <div style={{ fontSize: 10, color: "#60a5fa" }}>→ {ansvar}</div>}
                </div>
                <div style={s.barWrap}>
                  <div style={{ ...s.bar, width: `${pct}%` }} />
                </div>
                <span style={{ fontFamily: "monospace", fontSize: 12, color: "#f0f0f5", minWidth: 28, textAlign: "right" }}>{count}</span>
                <span style={{ fontSize: 11, color: "#555", minWidth: 32, textAlign: "right" }}>{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Dag-analys: bästa och sämsta dagar ───────────────── */}
      <div style={s.twoCol}>
        <div style={s.panel}>
          <div style={s.ph}>Bästa dagar (lägst promille)</div>
          {sortedDates
            .map((d) => ({ datum: d, ...dayMap[d], prom: promille(dayMap[d].avv, dayMap[d].rader) }))
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
          {sortedDates
            .map((d) => ({ datum: d, ...dayMap[d], prom: promille(dayMap[d].avv, dayMap[d].rader) }))
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

const s = {
  wrap:        { padding: "16px 20px", fontFamily: "system-ui, sans-serif", background: "#0a0a0f", minHeight: "100%", color: "#f0f0f5" },
  status:      { padding: 40, textAlign: "center", color: "#888" },
  sectionHdr:  { fontSize: 10, color: "#7c6af7", fontWeight: 700, textTransform: "uppercase", letterSpacing: 2, marginBottom: 10, marginTop: 20 },
  kpiGrid:     { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 20 },
  kpi:         { background: "#13131c", border: "1px solid #1e1e2e", borderRadius: 10, padding: "14px 16px" },
  kpiVal:      { fontSize: 28, fontWeight: 800, fontFamily: "monospace", marginBottom: 4 },
  kpiLbl:      { fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 1 },
  kpiSub:      { fontSize: 11, color: "#444", marginTop: 3 },
  actionList:  { display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 },
  actionRow:   { background: "#13131c", border: "1px solid #1e1e2e", borderLeft: "3px solid", borderRadius: "0 6px 6px 0", padding: "10px 14px" },
  actionTitel: { fontSize: 13, color: "#f0f0f5", fontWeight: 600 },
  actionDetalj:{ fontSize: 11, color: "#666", marginTop: 4 },
  kbanaTag:    { background: "#2a1a0a", color: "#f97316", border: "1px solid #3a2a1a", borderRadius: 4, padding: "1px 6px", fontSize: 10, fontWeight: 700, fontFamily: "monospace" },
  platsTag:    { background: "#0a0a1a", color: "#8a8a9a", border: "1px solid #1e1e2e", borderRadius: 4, padding: "1px 6px", fontSize: 10, fontFamily: "monospace" },
  twoCol:      { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 },
  panel:       { background: "#13131c", border: "1px solid #1e1e2e", borderRadius: 8, padding: "14px 16px" },
  ph:          { fontSize: 10, color: "#7c6af7", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 },
  dim:         { fontSize: 11, color: "#666" },
  recurRow:    { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #1a1a28" },
  vnrMono:     { fontFamily: "monospace", fontSize: 12, color: "#f0f0f5", marginRight: 8 },
  orsakRow:    { display: "grid", gridTemplateColumns: "1fr 80px 32px 36px", gap: 6, alignItems: "center", marginBottom: 8 },
  barWrap:     { background: "#1e1e2e", borderRadius: 3, height: 6, overflow: "hidden" },
  bar:         { height: "100%", background: "#7c6af7", borderRadius: 3, transition: "width .3s" },
  trendRow:    { display: "flex", gap: 6, alignItems: "center", padding: "4px 0", borderBottom: "1px solid #1a1a28", fontSize: 12 },
};
