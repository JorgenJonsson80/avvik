import { useState, useMemo } from "react";
import { useDeviationsContext } from "../context/DeviationsContext.jsx";
import { useSettings } from "../hooks/useSettings.js";
import { useRader } from "../hooks/useRader.js";
import { useOrgRole } from "../hooks/useOrgRole.js";
import { ScanDetailModal } from "./shared/ScanDetailModal.jsx";
import { OrsaksSelect } from "./shared/OrsaksSelect.jsx";
import { LoggaAtgardModal } from "./shared/LoggaAtgardModal.jsx";
import { DeleteDaysModal } from "./shared/DeleteDaysModal.jsx";
import { ORSAKER, ORSAK_ANSVAR } from "../lib/causes.js";
import { formatMinBefore } from "../lib/routes.js";
import { exportDeviationsToExcel } from "../lib/exportExcel.js";
import { daysAgoISO } from "../lib/dates.js";

export function HistorikTab() {
  const { deviations, loading, error, updateOrsak, updateKommentar, refetch: refetchDeviations } = useDeviationsContext();
  const { settings } = useSettings();
  const { rader, refetch: refetchRader } = useRader();
  const { isAdmin } = useOrgRole();
  const [filterDatum, setFilterDatum] = useState("");
  // Default: visa bara senaste 90 dagarna så gammal historik inte skymmer aktuell data.
  // Fälten är fria datumväljare — rensa fromDate för att se allt.
  const [fromDate, setFromDate] = useState(() => daysAgoISO(90));
  const [toDate, setToDate] = useState("");
  const [filterOrsak, setFilterOrsak] = useState("");
  const [filterZon, setFilterZon] = useState("");
  const [search, setSearch] = useState("");
  const [editId, setEditId] = useState(null);
  const [editOrsak, setEditOrsak] = useState("");
  const [editKommentar, setEditKommentar] = useState("");
  const [detailDev, setDetailDev] = useState(null);
  const [atgardDev, setAtgardDev] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteScope, setDeleteScope] = useState(null); // array of "YYYY-MM-DD" datum som ska raderas, eller null

  const allaDatum = useMemo(
    () => [...new Set(deviations.map((r) => String(r.datum).slice(0, 10)))].sort().reverse(),
    [deviations]
  );

  // Datum-omfånget för bulk-radering — styrs BARA av datumfiltren (inte
  // orsak/zon/sök), eftersom "radera dagar" ska radera hela dagen, inte bara
  // de rader som råkar matcha ett innehållsfilter.
  const candidateDates = useMemo(() => {
    if (filterDatum) return [filterDatum];
    return allaDatum.filter((d) => (!fromDate || d >= fromDate) && (!toDate || d <= toDate));
  }, [filterDatum, allaDatum, fromDate, toDate]);

  function handleDeleted() {
    setDeleteScope(null);
    refetchDeviations();
    refetchRader();
  }

  const filtered = useMemo(() => {
    let rows = deviations;
    if (filterDatum) {
      rows = rows.filter((r) => String(r.datum).slice(0, 10) === filterDatum);
    } else {
      if (fromDate) rows = rows.filter((r) => String(r.datum).slice(0, 10) >= fromDate);
      if (toDate)   rows = rows.filter((r) => String(r.datum).slice(0, 10) <= toDate);
    }
    if (filterOrsak) rows = rows.filter((r) => r.orsak === filterOrsak);
    if (filterZon)   rows = rows.filter((r) => r.zon === filterZon);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) =>
        r.vnr?.toLowerCase().includes(q) ||
        r.kommentar?.toLowerCase().includes(q) ||
        r.locations?.some((l) => l.toLowerCase().includes(q)) ||
        r.route_code?.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [deviations, filterDatum, fromDate, toDate, filterOrsak, filterZon, search]);

  const byDate = useMemo(() => {
    const map = {};
    for (const r of filtered) {
      if (!map[r.datum]) map[r.datum] = [];
      map[r.datum].push(r);
    }
    return map;
  }, [filtered]);

  const sortedDates = useMemo(
    () => Object.keys(byDate).sort((a, b) => b.localeCompare(a)),
    [byDate]
  );

  function startEdit(dev) {
    setEditId(dev.id);
    setEditOrsak(dev.orsak || "");
    setEditKommentar(dev.kommentar || "");
  }

  async function saveEdit(dev) {
    setSaving(true);
    try {
      if (editOrsak !== dev.orsak) await updateOrsak(dev.id, editOrsak);
      if (editKommentar !== dev.kommentar) await updateKommentar(dev.id, editKommentar);
      setEditId(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleScanSave(dominant) {
    if (dominant && detailDev && dominant !== detailDev.orsak) {
      await updateOrsak(detailDev.id, dominant);
    }
    setDetailDev(null);
  }

  if (loading) return <div style={s.status}>Laddar historik…</div>;
  if (error) return <div style={{ ...s.status, color: "#f87171" }}>Fel: {error}</div>;

  return (
    <div style={s.wrap}>
      {/* Filter-rad */}
      <div style={s.filters}>
        <select value={filterDatum} onChange={(e) => setFilterDatum(e.target.value)} style={s.filterSelect}>
          <option value="">Alla datum</option>
          {allaDatum.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          disabled={!!filterDatum}
          title="Från datum"
          style={{ ...s.filterSelect, opacity: filterDatum ? 0.4 : 1 }}
        />
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          disabled={!!filterDatum}
          title="Till datum"
          style={{ ...s.filterSelect, opacity: filterDatum ? 0.4 : 1 }}
        />
        {(fromDate || toDate) && !filterDatum && (
          <button
            onClick={() => { setFromDate(""); setToDate(""); }}
            style={{ ...s.filterSelect, color: "#7c6af7" }}
            title="Ta bort datumgränsen och visa all historik"
          >
            Visa allt
          </button>
        )}
        <input
          placeholder="Sök VNR, plats, tur, kommentar…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={s.searchInput}
        />
        <select value={filterZon} onChange={(e) => setFilterZon(e.target.value)} style={s.filterSelect}>
          <option value="">Alla zoner</option>
          <option value="1">Zon 1</option>
          <option value="2">Zon 2</option>
          <option value="3">Zon 3</option>
        </select>
        <select value={filterOrsak} onChange={(e) => setFilterOrsak(e.target.value)} style={s.filterSelect}>
          <option value="">Alla orsaker</option>
          {ORSAKER.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <span style={s.count}>{filtered.length} poster</span>
        <button
          onClick={() => exportDeviationsToExcel(filtered, { settings, rader, allDeviations: deviations })}
          disabled={filtered.length === 0}
          style={{ ...s.filterSelect, background: "#1a1a2e", color: filtered.length > 0 ? "#7c6af7" : "#333", border: "1px solid #2a2a4a", cursor: filtered.length > 0 ? "pointer" : "default", fontWeight: 600 }}
        >
          Exportera Excel
        </button>
        {isAdmin && candidateDates.length > 0 && (
          <button
            onClick={() => {
              // Färska siffror i bekräftelsemodalen — lokalt state kan vara
              // inaktuellt om någon importerat data sedan fliken laddades.
              refetchDeviations();
              refetchRader();
              setDeleteScope(candidateDates);
            }}
            title="Radera all data för de valda datumen (admin)"
            style={{ ...s.filterSelect, background: "#1e1015", color: "#f87171", border: "1px solid #4a1e1e", fontWeight: 600 }}
          >
            Radera {candidateDates.length === 1 ? "dagen" : `${candidateDates.length} dagar`}
          </button>
        )}
      </div>

      {/* Tom-state */}
      {sortedDates.length === 0 && (
        <div style={s.empty}>
          {deviations.length === 0
            ? "Inga avvikelser ännu. Importera data via Importera-fliken."
            : "Inga poster matchar filtret."}
        </div>
      )}

      {/* Datum-grupperade rader */}
      {sortedDates.map((datum) => {
        const rows = byDate[datum].slice().sort((a, b) => b.count - a.count);
        const totalCount = rows.reduce((s, r) => s + r.count, 0);
        return (
          <div key={datum} style={s.dateGroup}>
            <div style={s.dateHeader}>
              <span>{datum}</span>
              <span style={s.dateStats}>
                {rows.length} unika VNR · {totalCount} avvikelser
              </span>
              {isAdmin && (
                <button
                  onClick={() => setDeleteScope([datum])}
                  title="Radera hela dagen (admin)"
                  style={s.btnDeleteDay}
                >
                  🗑
                </button>
              )}
            </div>
            <div style={s.rowList}>
              {rows.map((dev) => {
                const isEditing = editId === dev.id;
                const isRoute850 = String(dev.route_code || "").trim() === "850";
                const isMissingOrsak = !dev.orsak || dev.orsak === "Okänd";
                return (
                  <div key={dev.id} style={{
                    ...s.devRow,
                    borderColor: isEditing ? "#7c6af7" : isRoute850 ? "#f87171" : isMissingOrsak ? "#fbbf24" : "#1e1e2e",
                    background: isEditing ? "#16162a" : isRoute850 ? "#281217" : isMissingOrsak ? "#28220f" : "#13131c",
                  }}>
                    <div style={s.devGrid}>
                      {/* VNR + meta */}
                      <span style={s.vnr}>
                        {dev.vnr}
                        {dev.locations?.[0] && <span style={s.loc}> {dev.locations[0]}</span>}
                        {dev.kbana && <span style={s.kbana}> {dev.kbana}</span>}
                        {dev.times?.length > 0 && <span style={s.times}> 🕐 {dev.times.join(", ")}</span>}
                        {dev.route_code && (
                          <span style={{ ...s.routeMeta, color: isRoute850 ? "#f87171" : s.routeMeta.color, fontWeight: isRoute850 ? 800 : 400 }}>
                            {" "}{isRoute850 ? "⚠ TUR 850" : `Tur ${dev.route_code}`}
                            {dev.avgangstid && <span style={s.avg}> · avg {dev.avgangstid}</span>}
                            {dev.min_fore_avgang != null && (
                              <span style={{ color: dev.min_fore_avgang < 60 ? "#f87171" : "#4ade80", fontWeight: 700 }}>
                                {" "}· {formatMinBefore(dev.min_fore_avgang, dev.nasta_dag)}
                              </span>
                            )}
                            {dev.nasta_dag && !dev.min_fore_avgang && <span style={s.dim}> · nästa dag</span>}
                          </span>
                        )}
                      </span>

                      {/* Count */}
                      <span style={{ ...s.countBadge, color: dev.count >= 10 ? "#f97316" : "#f0f0f5" }}>
                        ×{dev.count}
                      </span>

                      {/* Zon */}
                      <span style={{ ...s.zonBadge, background: ZON_BG[dev.zon] }}>Z{dev.zon || "?"}</span>

                      {/* Orsak + ansvar + kommentar */}
                      <span style={{ ...s.orsak, color: dev.orsak === "Okänd" || !dev.orsak ? "#f97316" : "#a0a0c0" }}>
                        {isMissingOrsak ? "⚠ Orsak saknas" : dev.orsak}
                        {ORSAK_ANSVAR[dev.orsak] && ORSAK_ANSVAR[dev.orsak] !== "—" && (
                          <span style={s.ansvar}> → {ORSAK_ANSVAR[dev.orsak]}</span>
                        )}
                        {dev.kommentar && <span style={s.dim}> · {dev.kommentar}</span>}
                      </span>

                      {/* Åtgärder */}
                      <div style={s.actions}>
                        {dev.count > 1 && (
                          <button
                            onClick={() => setDetailDev(dev)}
                            style={s.btnScans}
                            title="Visa per-scan-detaljer"
                          >
                            ⊞ {dev.kontroll_scans > 0
                              ? `${dev.kontroll_scans}/${dev.kontroll_total ?? dev.count}`
                              : `${dev.count} scans`}
                          </button>
                        )}
                        <button
                          onClick={() => setAtgardDev(dev)}
                          style={s.btnAtgard}
                          title="Logga åtgärd"
                        >
                          ⚡
                        </button>
                        <button
                          onClick={() => isEditing ? setEditId(null) : startEdit(dev)}
                          style={{ ...s.btnEdit, color: isEditing ? "#7c6af7" : "#444" }}
                          title="Redigera orsak och kommentar"
                        >
                          ✎
                        </button>
                      </div>
                    </div>

                    {/* Inline edit */}
                    {isEditing && (
                      <div style={s.editRow}>
                        <OrsaksSelect value={editOrsak} onChange={setEditOrsak} />
                        <input
                          placeholder="Kommentar…"
                          value={editKommentar}
                          onChange={(e) => setEditKommentar(e.target.value)}
                          style={s.editInput}
                        />
                        <button
                          onClick={() => saveEdit(dev)}
                          disabled={saving}
                          style={s.btnSave}
                        >
                          {saving ? "Sparar…" : "Spara"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {detailDev && (
        <ScanDetailModal
          deviation={detailDev}
          onClose={() => setDetailDev(null)}
          onSave={handleScanSave}
        />
      )}
      {atgardDev && (
        <LoggaAtgardModal
          vnr={atgardDev.vnr}
          location={atgardDev.locations?.[0]}
          kbana={atgardDev.kbana}
          onClose={() => setAtgardDev(null)}
        />
      )}
      {deleteScope && (
        <DeleteDaysModal
          dates={deleteScope}
          deviations={deviations}
          rader={rader}
          onClose={() => setDeleteScope(null)}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}

const ZON_BG = { "1": "#4ade80", "2": "#60a5fa", "3": "#f97316", "?": "#6b7280" };

const s = {
  wrap: { padding: "16px 20px", fontFamily: "system-ui, sans-serif", background: "#0a0a0f", minHeight: "100%", color: "#f0f0f5" },
  status: { padding: 40, textAlign: "center", color: "#888" },
  filters: { display: "flex", gap: 8, marginBottom: 20, alignItems: "center", flexWrap: "wrap" },
  searchInput: { flex: 1, minWidth: 200, background: "#13131c", border: "1px solid #2a2a3a", color: "#f0f0f5", borderRadius: 6, padding: "6px 12px", fontSize: 13, outline: "none" },
  filterSelect: { background: "#13131c", border: "1px solid #2a2a3a", color: "#f0f0f5", borderRadius: 6, padding: "6px 10px", fontSize: 12, cursor: "pointer" },
  count: { fontSize: 11, color: "#555", marginLeft: "auto" },
  empty: { textAlign: "center", color: "#555", paddingTop: 60, fontSize: 14 },
  dateGroup: { marginBottom: 28 },
  dateHeader: { display: "flex", alignItems: "center", gap: 12, marginBottom: 8, fontSize: 11, color: "#7c6af7", fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" },
  dateStats: { color: "#444", fontWeight: 400, letterSpacing: 0 },
  btnDeleteDay: { marginLeft: "auto", background: "none", border: "none", color: "#663333", cursor: "pointer", fontSize: 12, padding: 0, opacity: 0.7 },
  rowList: { display: "flex", flexDirection: "column", gap: 4 },
  devRow: { background: "#13131c", border: "1px solid", borderRadius: 6, padding: "8px 12px", fontSize: 12 },
  devGrid: { display: "grid", gridTemplateColumns: "1fr 56px 44px 1fr 80px", gap: 8, alignItems: "center" },
  vnr: { fontFamily: "monospace", color: "#f0f0f5", fontSize: 12 },
  loc: { color: "#8a8a9a", fontSize: 11 },
  kbana: { color: "#f97316", fontWeight: 700, fontSize: 10 },
  times: { color: "#7c6af7", fontSize: 10 },
  routeMeta: { color: "#666", fontSize: 10 },
  avg: { color: "#60a5fa" },
  dim: { color: "#555" },
  countBadge: { textAlign: "center", fontFamily: "monospace", fontWeight: 700, fontSize: 13 },
  zonBadge: { color: "#0a0a0f", borderRadius: 4, padding: "2px 6px", fontSize: 11, fontWeight: 700, fontFamily: "monospace", textAlign: "center" },
  orsak: { fontSize: 11 },
  ansvar: { color: "#60a5fa", fontSize: 10 },
  actions: { display: "flex", gap: 6, alignItems: "center", justifyContent: "flex-end" },
  btnScans:  { background: "none", border: "1px solid #2a2a3a", borderRadius: 5, color: "#888", cursor: "pointer", fontSize: 10, padding: "2px 6px", fontFamily: "inherit", whiteSpace: "nowrap" },
  btnAtgard: { background: "none", border: "none", cursor: "pointer", fontSize: 13, padding: 0, opacity: 0.5 },
  btnEdit:   { background: "none", border: "none", cursor: "pointer", fontSize: 14, padding: 0 },
  editRow: { display: "flex", gap: 8, marginTop: 10, alignItems: "center" },
  editInput: { flex: 1, background: "#0f0f18", border: "1px solid #2a2a3a", color: "#f0f0f5", borderRadius: 6, padding: "5px 10px", fontSize: 12, outline: "none" },
  btnSave: { background: "#7c6af7", color: "#fff", border: "none", borderRadius: 6, padding: "5px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" },
};
