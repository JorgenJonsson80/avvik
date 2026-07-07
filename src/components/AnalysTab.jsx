// src/components/AnalysTab.jsx
// Analys-fliken med:
//  - Intervallfilter (3 / 7 / 14 / 30 dagar / All)
//  - Trend (ökande/stabil/minskande, första halvan vs andra halvan)
//  - Mest kritisk zon, vanligaste orsak
//  - Återkommande VNR (sorterat på streak)
//  - Aktiva streaks (konsekutiva dagar fram till senaste datadag)
//  - Mest kritiska tidpunkt (timme med flest avvikelser, visas som intervall "13–14")
//  - Konkret åtgärdslista (rule-based, prioriterad) — utan AI-anrop
//
// Kopierad ur den fungerande single-file-appen och anpassad till repots fältnamn
// (snake_case: route_code, min_fore_avgang osv).

import { useState, useMemo } from "react";
import { useDeviations } from "../hooks/useDeviations.js";
import { orsakBreakdown } from "../lib/orsak.js";
import { classifyLocation } from "../lib/classify.js";
import { ORSAK_ANSVAR } from "../lib/causes.js";
import { LoggaAtgardModal } from "./shared/LoggaAtgardModal.jsx";

function Badge({ text }) {
  const colors = {
    "1": "#4ade80", "2": "#60a5fa", "3": "#f97316",
    "Loax": "#a78bfa", "KG kyl": "#22d3ee", "?": "#6b7280",
  };
  const isNum = /^\d+$/.test(text);
  return (
    <span style={{
      background: colors[text] || "#6b7280", color: "#0a0a0f",
      borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700,
      fontFamily: "monospace", letterSpacing: 1, whiteSpace: "nowrap",
    }}>{isNum ? `Z${text}` : text}</span>
  );
}

export function AnalysTab() {
  const { deviations, loading } = useDeviations();
  const [filterDagar, setFilterDagar] = useState("30");
  const [copiedKey, setCopiedKey] = useState(null);
  const [atgardVnr, setAtgardVnr] = useState(null); // { vnr, location, kbana }

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

  // ── Filtrera på dagar bakåt från senaste datadag ──────────────────────────
  const filtered = useMemo(() => {
    const all = deviations.filter((r) => r.vnr);
    if (all.length === 0) return [];
    if (filterDagar === "all") return all;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - parseInt(filterDagar, 10));
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return all.filter((r) => String(r.datum).slice(0, 10) >= cutoffStr);
  }, [deviations, filterDagar]);

  // ── Grundsummor ───────────────────────────────────────────────────────────
  const totalAvv = useMemo(() => filtered.reduce((s, r) => s + (r.count || 0), 0), [filtered]);
  const dates = useMemo(
    () => [...new Set(filtered.map((r) => String(r.datum).slice(0, 10)))].sort(),
    [filtered]
  );

  // ── Per zon (för "kritisk zon"-kortet) ────────────────────────────────────
  const zonRank = useMemo(() => {
    const m = {};
    for (const r of filtered) {
      const z = r.zon || "?";
      if (!m[z]) m[z] = { count: 0, vnrs: new Set() };
      m[z].count += r.count || 0;
      m[z].vnrs.add(r.vnr);
    }
    return Object.entries(m).sort((a, b) => b[1].count - a[1].count);
  }, [filtered]);

  // ── Återkommande VNR + streaks ────────────────────────────────────────────
  const vnrInfo = useMemo(() => {
    const m = {};
    for (const r of filtered) {
      const datum = String(r.datum).slice(0, 10);
      if (!m[r.vnr]) {
        m[r.vnr] = {
          days: new Set(),
          total: 0,
          zon: r.zon,
          orsak: r.orsak,
          location: r.locations?.[0] || "",
          kbana: r.kbana || classifyLocation(r.locations?.[0]) || "",
        };
      }
      m[r.vnr].days.add(datum);
      m[r.vnr].total += r.count || 0;
    }
    return m;
  }, [filtered]);

  // Längsta konsekutiva svit (oavsett om aktiv eller inte)
  const longestStreak = (daysSet) => {
    const sorted = [...daysSet].sort();
    if (sorted.length === 0) return 0;
    let best = 1, cur = 1;
    for (let i = 1; i < sorted.length; i++) {
      const diff = Math.round(
        (new Date(sorted[i]) - new Date(sorted[i - 1])) / 86400000
      );
      if (diff === 1) { cur++; best = Math.max(best, cur); }
      else cur = 1;
    }
    return best;
  };
  const streakActive = (daysSet, lastDataDay) => {
    const sorted = [...daysSet].sort();
    return sorted[sorted.length - 1] === lastDataDay;
  };
  const lastDataDay = dates[dates.length - 1];

  const recurringAll = useMemo(() => {
    return Object.entries(vnrInfo)
      .map(([vnr, v]) => ({
        vnr,
        days: v.days.size,
        streak: longestStreak(v.days),
        active: streakActive(v.days, lastDataDay),
        total: v.total,
        zon: v.zon,
        orsak: v.orsak,
        location: v.location,
        kbana: v.kbana,
      }))
      .filter((v) => v.days > 1)
      .sort((a, b) => b.streak - a.streak || b.total - a.total);
  }, [vnrInfo, lastDataDay]);

  // ── Mest kritiska tidpunkt (timme med flest avvikelser) ───────────────────
  const hourStats = useMemo(() => {
    const hourMap = {};
    let totalSamples = 0;
    for (const r of filtered) {
      // events kan komma som scans-tabell (egen tabell) eller som inbäddad array.
      // Försök båda; använd r.hours som sista fallback.
      const events = Array.isArray(r.events) ? r.events
        : Array.isArray(r.scans) ? r.scans : null;
      if (events) {
        for (const ev of events) {
          if (ev?.tid) {
            const h = parseInt(String(ev.tid).split(":")[0], 10);
            if (!isNaN(h)) { hourMap[h] = (hourMap[h] || 0) + 1; totalSamples++; }
          }
        }
      } else if (Array.isArray(r.hours)) {
        for (const h of r.hours) { hourMap[h] = (hourMap[h] || 0) + 1; totalSamples++; }
      }
    }
    const top = Object.entries(hourMap).sort((a, b) => b[1] - a[1])[0];
    return { top, totalSamples };
  }, [filtered]);

  // ── Trend (första halvan vs andra halvan) ─────────────────────────────────
  const trend = useMemo(() => {
    const perDay = {};
    for (const r of filtered) {
      const d = String(r.datum).slice(0, 10);
      perDay[d] = (perDay[d] || 0) + (r.count || 0);
    }
    const vals = dates.map((d) => perDay[d] || 0);
    const half = Math.floor(vals.length / 2);
    const first = vals.slice(0, half);
    const last = vals.slice(half);
    const firstAvg = first.reduce((s, v) => s + v, 0) / (first.length || 1);
    const lastAvg = last.reduce((s, v) => s + v, 0) / (last.length || 1);
    const diff = lastAvg - firstAvg;
    const label = diff > 5 ? "↑ Ökande" : diff < -5 ? "↓ Minskande" : "→ Stabil";
    const color = diff > 5 ? "#f97316" : diff < -5 ? "#4ade80" : "#60a5fa";
    return { label, color, firstAvg, lastAvg };
  }, [filtered, dates]);

  // ── Vanligaste orsak (per scan-orsak via orsakBreakdown) ──────────────────
  const topOrsak = useMemo(() => {
    const m = {};
    for (const r of filtered) {
      const dist = orsakBreakdown(r);
      for (const [o, n] of Object.entries(dist)) {
        if (n > 0) m[o] = (m[o] || 0) + n;
      }
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1])[0];
  }, [filtered]);

  // ── Kritiska före avgång (< 30 min) ───────────────────────────────────────
  const criticalDeparture = useMemo(
    () => filtered.filter((r) =>
      r.min_fore_avgang !== null && r.min_fore_avgang !== undefined
      && !r.nasta_dag && r.min_fore_avgang < 30),
    [filtered]
  );

  // ── Åtgärdslista (rule-based, prioriterad) ────────────────────────────────
  const actions = useMemo(() => {
    const out = [];
    // 1. Aktiva streaks ≥ 2 → hög prio
    for (const v of recurringAll.filter((v) => v.streak >= 2 && v.active).slice(0, 12)) {
      out.push({
        pri: v.streak >= 3 ? "hög" : "medel",
        sortKey: 100 + v.streak * 10,
        vnr: v.vnr,
        location: v.location,
        kbana: v.kbana,
        text: `${v.streak} dagar i rad — inventera platsen eller kolla påfyllningsrutin`,
        info: `Total: ×${v.total} · senaste orsak: ${v.orsak || "—"}`,
      });
    }
    // 2. Återkommande ≥ 3 olika dagar (ej i följd)
    for (const v of recurringAll.filter((v) => v.days >= 3 && !(v.streak >= 2 && v.active)).slice(0, 8)) {
      out.push({
        pri: "medel",
        sortKey: 50 + v.days,
        vnr: v.vnr,
        location: v.location,
        kbana: v.kbana,
        text: `återkommande problem på ${v.days} olika dagar`,
        info: `Total: ×${v.total} · vanlig orsak: ${v.orsak || "—"}`,
      });
    }
    // 3. Hög dagsvolym ≥ 10 på en VNR
    for (const r of filtered.filter((r) => r.count >= 10).slice(0, 6)) {
      out.push({
        pri: "medel",
        sortKey: 30 + Math.min(r.count, 30),
        vnr: r.vnr,
        location: r.locations?.[0] || "",
        kbana: r.kbana || classifyLocation(r.locations?.[0]) || "",
        text: `${r.count} avvikelser samma dag (${String(r.datum).slice(0, 10)}) — engångstopp, kolla saldo`,
        info: r.orsak ? `Orsak: ${r.orsak}` : "",
      });
    }
    // Deduplicera på vnr + text
    const seen = new Set();
    const dedup = [];
    for (const a of out.sort((a, b) => b.sortKey - a.sortKey)) {
      const k = `${a.vnr}|${a.text}`;
      if (!seen.has(k)) { seen.add(k); dedup.push(a); }
    }
    return dedup;
  }, [recurringAll, filtered]);

  // ── Formatterare: ren text, klar att klistra in i Teams/Slack/SMS ──
  const formatAction = (a) => {
    const loc = a.location ? ` (${a.location}${a.kbana ? `, ${a.kbana}` : ""})` : "";
    return `[${a.pri.toUpperCase()}] VNR ${a.vnr}${loc} — ${a.text}`;
  };
  const formatAllActions = () => {
    const periodLabel = filterDagar === "all" ? "all historik" : `senaste ${filterDagar} dagarna`;
    const header = `Att kolla upp (${periodLabel}, ${actions.length} st):`;
    const lines = actions.map((a, i) => `${i + 1}. ${formatAction(a)}`);
    return [header, ...lines].join("\n");
  };

  if (loading) return <div style={s.status}>Laddar analys…</div>;

  if (filtered.length === 0) {
    return (
      <div style={s.wrap}>
        <div style={s.filterRow}>
          <select value={filterDagar} onChange={(e) => setFilterDagar(e.target.value)} style={s.sel}>
            <option value="3">Senaste 3 dagarna</option>
            <option value="7">Senaste 7 dagarna</option>
            <option value="14">Senaste 14 dagarna</option>
            <option value="30">Senaste 30 dagarna</option>
            <option value="all">All historik</option>
          </select>
        </div>
        <div style={s.empty}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔍</div>
          <div style={{ fontSize: 14 }}>Ingen data att analysera i valt intervall</div>
        </div>
      </div>
    );
  }

  const activeStreaks = recurringAll.filter((v) => v.streak >= 2 && v.active);

  return (
    <div style={s.wrap}>
      {/* Filter */}
      <div style={s.filterRow}>
        <select value={filterDagar} onChange={(e) => setFilterDagar(e.target.value)} style={s.sel}>
          <option value="3">Senaste 3 dagarna</option>
          <option value="7">Senaste 7 dagarna</option>
          <option value="14">Senaste 14 dagarna</option>
          <option value="30">Senaste 30 dagarna</option>
          <option value="all">All historik</option>
        </select>
        <span style={s.dim}>{filtered.length} poster · {totalAvv} avvikelser · {dates.length} dagar</span>
      </div>

      {/* Översikts-kort */}
      <div style={s.cardGrid}>
        <div style={s.card}>
          <div style={s.cardLabel}>Trend</div>
          <div style={{ ...s.cardValue, color: trend.color }}>{trend.label}</div>
          <div style={s.cardSub}>
            Första halvan: {Math.round(trend.firstAvg)}/dag → andra halvan: {Math.round(trend.lastAvg)}/dag
          </div>
        </div>

        <div style={s.card}>
          <div style={s.cardLabel}>Kritisk zon</div>
          {zonRank[0] && (
            <>
              <div style={{ ...s.cardValue, color: "#f97316" }}>
                {/^\d+$/.test(zonRank[0][0]) ? `Zon ${zonRank[0][0]}` : zonRank[0][0]}
              </div>
              <div style={s.cardSub}>
                {zonRank[0][1].count} avvikelser · {zonRank[0][1].vnrs.size} unika VNR
                {" · "}{Math.round(zonRank[0][1].count / totalAvv * 100)}% av totalt
              </div>
            </>
          )}
        </div>

        <div style={s.card}>
          <div style={s.cardLabel}>Vanligaste orsak</div>
          {topOrsak && (
            <>
              <div style={{ ...s.cardValue, color: "#7c6af7", fontSize: 18 }}>{topOrsak[0]}</div>
              <div style={s.cardSub}>
                {topOrsak[1]} avvikelser · {Math.round(topOrsak[1] / totalAvv * 100)}% av totalt
              </div>
            </>
          )}
        </div>

        <div style={s.card}>
          <div style={s.cardLabel}>Aktiva streaks</div>
          <div style={{ ...s.cardValue, color: "#f87171" }}>{activeStreaks.length}</div>
          <div style={s.cardSub}>VNR med pågående avvikelse i ≥2 dagar i rad</div>
        </div>

        <div style={s.card}>
          <div style={s.cardLabel}>Mest kritiska tidpunkt</div>
          {hourStats.top ? (
            <>
              <div style={{ ...s.cardValue, color: "#f97316", fontFamily: "monospace" }}>
                {String(hourStats.top[0]).padStart(2, "0")}–{String((parseInt(hourStats.top[0]) + 1) % 24).padStart(2, "0")}
              </div>
              <div style={s.cardSub}>
                {hourStats.top[1]} avvikelser denna timme
                {hourStats.totalSamples > 0 && ` · ${Math.round(hourStats.top[1] / hourStats.totalSamples * 100)}% av tidsstämplade`}
              </div>
            </>
          ) : <div style={s.dim}>Ingen tidsdata</div>}
        </div>

        <div style={s.card}>
          <div style={s.cardLabel}>{"< 30 min före avgång"}</div>
          <div style={{ ...s.cardValue, color: criticalDeparture.length > 0 ? "#f87171" : "#4ade80" }}>
            {criticalDeparture.reduce((sum, r) => sum + (r.count || 0), 0)}
          </div>
          <div style={s.cardSub}>Avvikelser kritiskt nära avgång</div>
        </div>
      </div>

      {/* Åtgärdslista */}
      {actions.length > 0 && (
        <div style={s.panel}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={s.panelHead}>Att kolla upp</div>
            <button
              onClick={() => copyText(formatAllActions(), "all")}
              style={{
                background: copiedKey === "all" ? "#1e3a28" : "#1e1e2e",
                color: copiedKey === "all" ? "#4ade80" : "#888",
                border: "1px solid #2a2a3a", borderRadius: 6, padding: "5px 12px",
                fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              }}
            >{copiedKey === "all" ? "✓ Kopierat" : "📋 Kopiera alla"}</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {actions.map((a, i) => (
              <div key={i} style={{
                display: "flex", gap: 10, alignItems: "flex-start",
                background: "#0f0f18", borderRadius: 6, padding: "10px 12px",
                borderLeft: `3px solid ${a.pri === "hög" ? "#f87171" : "#fbbf24"}`,
              }}>
                <span style={{
                  fontSize: 10, color: a.pri === "hög" ? "#f87171" : "#fbbf24",
                  fontWeight: 700, textTransform: "uppercase", letterSpacing: 1,
                  minWidth: 50,
                }}>{a.pri}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ color: "#f0f0f5", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span>VNR <span style={{ fontFamily: "monospace", color: "#60a5fa" }}>{a.vnr}</span></span>
                    {a.location && (
                      <span style={{
                        background: "#1a2535", color: "#7cc4ff", fontFamily: "monospace",
                        fontWeight: 700, fontSize: 12, borderRadius: 4, padding: "2px 8px",
                      }}>📍 {a.location}</span>
                    )}
                    {a.kbana && (
                      <span style={{ color: "#f97316", fontWeight: 700, fontSize: 11 }}>{a.kbana}</span>
                    )}
                  </div>
                  <div style={{ color: "#c0c0d0", marginTop: 4, fontSize: 13 }}>{a.text}</div>
                  {a.info && <div style={{ color: "#555", fontSize: 11, marginTop: 2 }}>{a.info}</div>}
                </div>
                <div style={{ display: "flex", gap: 4, flexShrink: 0, marginTop: 1 }}>
                  <button
                    onClick={() => setAtgardVnr({ vnr: a.vnr, location: a.location, kbana: a.kbana })}
                    title="Logga åtgärd"
                    style={{ background: "none", color: "#7c6af7", border: "none", cursor: "pointer", fontSize: 13, padding: "2px 4px" }}
                  >⚡</button>
                  <button
                    onClick={() => copyText(formatAction(a), i)}
                    title="Kopiera den här åtgärden"
                    style={{ background: "none", color: copiedKey === i ? "#4ade80" : "#555", border: "none", cursor: "pointer", fontSize: 13, padding: "2px 4px" }}
                  >{copiedKey === i ? "✓" : "📋"}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Återkommande VNR */}
      {recurringAll.length > 0 && (
        <div style={s.panel}>
          <div style={s.panelHead}>Återkommande VNR ({recurringAll.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {recurringAll.slice(0, 20).map((v) => (
              <div key={v.vnr} style={{
                display: "grid",
                gridTemplateColumns: "1fr 80px 80px 60px 60px 1fr 28px",
                gap: 8, alignItems: "center",
                background: v.active && v.streak >= 2 ? "#15100f" : "#0f0f18",
                border: v.active && v.streak >= 3 ? "1px solid #7a3030" : "1px solid transparent",
                borderRadius: 6, padding: "8px 12px", fontSize: 12,
              }}>
                <span style={{ fontFamily: "monospace", color: "#f0f0f5" }}>{v.vnr}</span>
                {v.location && <span style={{ fontSize: 11, color: "#8a8a9a", fontFamily: "monospace" }}>{v.location}</span>}
                <span style={{
                  fontFamily: "monospace", fontWeight: 700,
                  color: v.streak >= 3 ? "#f87171" : v.streak >= 2 ? "#fbbf24" : "#888",
                }}>
                  {v.streak} {v.streak === 1 ? "dag" : "dagar"}{v.active && v.streak >= 2 ? " ●" : ""}
                </span>
                <span style={{ color: "#888" }}>×{v.total}</span>
                <Badge text={v.zon} />
                <span style={{ color: "#555", fontSize: 11 }}>
                  {v.orsak || "—"}
                  {ORSAK_ANSVAR[v.orsak] && ORSAK_ANSVAR[v.orsak] !== "—" && (
                    <span style={{ color: "#60a5fa", marginLeft: 6 }}>→ {ORSAK_ANSVAR[v.orsak]}</span>
                  )}
                </span>
                <button
                  onClick={() => setAtgardVnr({ vnr: v.vnr, location: v.location, kbana: v.kbana })}
                  title="Logga åtgärd"
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#7c6af7", padding: 0 }}
                >⚡</button>
              </div>
            ))}
          </div>
          {recurringAll.length > 20 && (
            <div style={{ ...s.dim, marginTop: 8 }}>Visar 20 första av {recurringAll.length}</div>
          )}
        </div>
      )}

      {atgardVnr && (
        <LoggaAtgardModal
          vnr={atgardVnr.vnr}
          location={atgardVnr.location}
          kbana={atgardVnr.kbana}
          onClose={() => setAtgardVnr(null)}
        />
      )}
    </div>
  );
}

const s = {
  wrap:       { padding: "16px 20px", fontFamily: "system-ui, sans-serif", background: "#0a0a0f", minHeight: "100%", color: "#f0f0f5" },
  status:     { padding: 40, textAlign: "center", color: "#888" },
  empty:      { textAlign: "center", padding: "60px 0", color: "#444" },
  filterRow:  { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 20 },
  dim:        { fontSize: 12, color: "#555" },
  sel:        { background: "#16161f", color: "#f0f0f5", border: "1px solid #2a2a3a", borderRadius: 6, padding: "6px 10px", fontSize: 12, cursor: "pointer", outline: "none" },
  cardGrid:   { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 20 },
  card:       { background: "#13131c", border: "1px solid #1e1e2e", borderRadius: 10, padding: 20 },
  cardLabel:  { fontSize: 11, color: "#555", letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 },
  cardValue:  { fontSize: 28, fontWeight: 800, fontFamily: "monospace" },
  cardSub:    { fontSize: 12, color: "#666", marginTop: 6 },
  panel:      { background: "#13131c", border: "1px solid #1e1e2e", borderRadius: 10, padding: 20, marginBottom: 20 },
  panelHead:  { fontSize: 11, color: "#555", letterSpacing: 1, textTransform: "uppercase", marginBottom: 14 },
};
