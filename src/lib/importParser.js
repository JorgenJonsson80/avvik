// importParser.js
// Pure functions för att tolka X08-avvikelserapport och rader-rapport.
// Inga React- eller Supabase-beroenden — testbara isolerat.
//
// KRITISKT: parseTimeFi justerar JDE_TIME_OFFSET = -1. Om JDE-exporten ändras
// (systemuppgradering, tidszonsrättning) — se över den raden. Annars blir ALLA
// tidsstämplar och "min före avgång"-beräkningar fel utan synligt felmeddelande.

import * as XLSX from "xlsx";
import { excelDateToISO } from "./dates.js";
import { classifyLocation, getZon, stationToZon } from "./classify.js";
import { getAvgangstid, minutesBeforeDeparture } from "./routes.js";
import { markKontrollScans, kontrollStatsByVnr, kontrollArea, scanOrsak } from "./kontroll.js";

// ─── Tidstolkning ────────────────────────────────────────────────────────────

// JDE exporterar "Time Updated" en timme fel mot lokal tid.
const JDE_TIME_OFFSET = -1;

export function parseTimeFi(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  let h = -1, m = 0, sec = 0;
  if (raw instanceof Date) {
    h = raw.getHours(); m = raw.getMinutes(); sec = raw.getSeconds();
  } else {
    const str = String(raw).trim();
    if (str.includes(":")) {
      const p = str.split(":");
      h = parseInt(p[0], 10); m = parseInt(p[1], 10); sec = parseInt(p[2] || 0, 10);
    } else {
      const num = parseInt(String(raw).replace(/\D/g, ""), 10);
      if (!isNaN(num)) {
        sec = num % 100; m = Math.floor(num / 100) % 100; h = Math.floor(num / 10000);
      }
    }
  }
  if (h < 0 || isNaN(h)) return null;
  h = h + JDE_TIME_OFFSET;
  if (h < 0) h += 24;
  return { h, m, s: sec };
}

// ─── X08-parser ──────────────────────────────────────────────────────────────

/**
 * Hittar rubrikraden i ett ark (en rad där minst 3 kända nyckelord finns).
 * Returnerar { hIdx, headers } eller null.
 */
function findHeader(rows) {
  // JDE-export: "2nd Item Number" + "Location" är de säkraste rubrikerna
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = rows[i].map((c) => String(c ?? "").toLowerCase().trim());
    if (cells.some((c) => c.includes("item number")) && cells.some((c) => c === "location")) {
      return { hIdx: i, headers: cells };
    }
  }
  // Fallback: svenska kolumnnamn
  const keywords = ["artikelnummer", "lagerplats", "tur", "tid", "datum"];
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = rows[i].map((c) => String(c ?? "").toLowerCase().trim());
    const hits = keywords.filter((k) => cells.some((c) => c.includes(k)));
    if (hits.length >= 3) return { hIdx: i, headers: cells };
  }
  return null;
}

function colIdx(headers, ...candidates) {
  for (const c of candidates) {
    const i = headers.findIndex((h) => h.includes(c));
    if (i !== -1) return i;
  }
  return -1;
}

// JDE-exporter slår ofta ihop celler (merged cells) i kolumner som upprepar
// samma värde för flera rader i rad (t.ex. artikelnummer vid flera scanningar
// efter varandra). sheet_to_json fyller INTE i det — bara toppcellen i
// sammanslagningen får ett värde, resten blir tomma strängar. Utan denna
// utfyllnad tolkas de tomma raderna som saknad VNR och filtreras bort tyst,
// vilket ger för lågt antal (×count) för just de VNR som scannats flest gånger.
function fillMergedCells(sheet, rows) {
  const merges = sheet["!merges"] || [];
  for (const m of merges) {
    const topVal = rows[m.s.r]?.[m.s.c];
    for (let r = m.s.r; r <= m.e.r; r++) {
      if (rows[r]) rows[r][m.s.c] = topVal;
    }
  }
  return rows;
}

/**
 * Parsar ett X08-Excel-WorkBook till en lista av deviation-records med events[].
 * Returnerar { records, datum, error }.
 */
export function parseX08(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = fillMergedCells(sheet, XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }));

  const found = findHeader(rows);
  if (!found) return { records: [], datum: null, error: "Hittade ingen rubrikrad med kända kolumner." };
  const { hIdx, headers } = found;

  // JDE-export använder engelska kolumnnamn: "2nd item number", "location", "route code", etc.
  const vnrCol    = headers.findIndex((h) => h.includes("item number") && !h.includes("branch"))
    !== -1 ? headers.findIndex((h) => h.includes("item number") && !h.includes("branch"))
    : colIdx(headers, "artikelnummer", "vnr", "artikel");
  const locCol    = headers.findIndex((h) => h === "location") !== -1
    ? headers.findIndex((h) => h === "location")
    : colIdx(headers, "lagerplats", "plats");
  const routeCol  = colIdx(headers, "route", "tur", "ruttid");
  const shipCol   = colIdx(headers, "ship to", "ship", "levplats", "kund");
  const timeCol   = colIdx(headers, "time updated", "tid upd", "tid", "time");
  let datumCol    = headers.findIndex((h) => h.includes("date updated"));
  if (datumCol === -1) datumCol = headers.findIndex((h) => h.includes("creation date"));
  if (datumCol === -1) datumCol = colIdx(headers, "datum", "date");

  if (vnrCol === -1) return { records: [], datum: null, error: "Hittar inte artikelnummer-kolumn." };

  const dataRows = rows.slice(hIdx + 1).filter((r) => {
    const v = String(r[vnrCol] ?? "").trim();
    return v.length > 0 && v !== "Artikelnummer" && v !== "0";
  });

  if (dataRows.length === 0) return { records: [], datum: null, error: "Inga datarader hittades." };

  // Detektera datum från första dataraden
  let detDatum = null;
  if (datumCol !== -1 && dataRows[0]) {
    detDatum = excelDateToISO(dataRows[0][datumCol]);
  }

  // Bygg map VNR → aggregat
  const map = new Map();
  for (const row of dataRows) {
    const vnr = String(row[vnrCol] ?? "").trim();
    if (!vnr) continue;
    const loc   = String(row[locCol]   ?? "").trim();
    const route = String(row[routeCol] ?? "").trim();
    const ship  = String(row[shipCol]  ?? "").trim();
    const t     = parseTimeFi(row[timeCol]);

    if (!map.has(vnr)) {
      map.set(vnr, {
        vnr, locations: new Set(), routes: new Set(), ships: new Set(),
        count: 0, afterHours: 0, beforeWork: 0, hours: [], times: [],
        firstTimeMs: Infinity, events: [],
      });
    }
    const e = map.get(vnr);
    e.count++;
    if (loc)   e.locations.add(loc);
    if (route) e.routes.add(route);
    if (ship)  e.ships.add(ship);

    let tStr = "";
    let tMs  = null;
    if (t) {
      tStr = `${String(t.h).padStart(2, "0")}:${String(t.m).padStart(2, "0")}`;
      tMs  = t.h * 3_600_000 + t.m * 60_000 + t.s * 1_000;
      e.times.push(tStr);
      e.hours.push(t.h);
      if (tMs < e.firstTimeMs) e.firstTimeMs = tMs;
      if (t.h > 15 || (t.h === 15 && t.m >= 30)) e.afterHours++;
      if (t.h < 8) e.beforeWork++;
    }

    const avg = getAvgangstid(route);
    const minFore = tStr && avg.tid ? minutesBeforeDeparture(tStr, avg.tid) : null;
    e.events.push({
      tid: tStr,
      location: loc,
      route_code: route,
      ship_to: ship,
      avgangstid: avg.tid || "",
      nasta_dag: avg.nastaDag,
      min_fore_avgang: minFore,
      in_kontroll: false, // fylls i nedan
      orsak: "",          // fylls alltid från VNR-dagens orsak, aldrig från inKontroll
    });
  }

  // Kontroll-detection (2-min glidande fönster, per scan)
  const allScans = [];
  for (const [vnr, e] of map.entries()) {
    for (const ev of e.events) {
      if (!ev.tid) continue;
      const [hh, mm] = ev.tid.split(":").map(Number);
      allScans.push({ vnr, area: kontrollArea(ev.location), timeMs: hh * 3_600_000 + mm * 60_000 });
    }
  }
  const marked    = markKontrollScans(allScans);
  const kStats    = kontrollStatsByVnr(marked);

  // Bygg nyckel vnr|HH:MM → inKontroll
  const kontrollKey = new Map();
  for (const s of marked) {
    if (!s.inKontroll) continue;
    const totalMin = Math.floor(s.timeMs / 60_000);
    const hh = String(Math.floor(totalMin / 60) % 24).padStart(2, "0");
    const mm = String(totalMin % 60).padStart(2, "0");
    kontrollKey.set(`${s.vnr}|${hh}:${mm}`, true);
  }

  const records = [];
  for (const [vnr, e] of map.entries()) {
    const locsArr   = [...e.locations];
    const routesArr = [...e.routes];
    const shipsArr  = [...e.ships];
    const sortedTimes = e.times.sort();
    const firstTime   = e.firstTimeMs === Infinity ? "" : sortedTimes[0];
    const routeCode   = routesArr[0] || "";
    const { tid: avgangstid, nastaDag } = getAvgangstid(routeCode);
    const minFore = firstTime && avgangstid ? minutesBeforeDeparture(firstTime, avgangstid) : null;
    const zon   = getZon(locsArr[0] || "");
    const kbana = classifyLocation(locsArr[0] || "") || "";
    const st    = kStats.get(vnr);

    const autoOrsak =
      zon === "Loax" || zon === "KG kyl" ? "Övrigt" :
      e.beforeWork === e.count ? "Före 08:00" :
      e.afterHours === e.count ? "Utanför min arbetstid" : "";

    // Per-scan orsak: Loax/KG kyl > tid (Före 08/Utanför arbetstid) > kontroll > autoOrsak
    for (const ev of e.events) {
      ev.in_kontroll = kontrollKey.get(`${vnr}|${ev.tid}`) === true;
      let h = null, m = 0;
      if (ev.tid) { const p = ev.tid.split(":").map(Number); h = p[0]; m = p[1]; }
      ev.orsak = scanOrsak(h, m, ev.in_kontroll, autoOrsak, zon);
    }

    // Dagsorsak: autoOrsak om satt, annars dominant scan-orsak
    let dagOrsak = autoOrsak;
    if (!dagOrsak) {
      const c = {};
      for (const ev of e.events) if (ev.orsak) c[ev.orsak] = (c[ev.orsak] || 0) + 1;
      const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
      if (top) dagOrsak = top[0];
    }

    records.push({
      vnr,
      datum: detDatum,
      locations:       locsArr,
      routes:          routesArr,
      ships:           shipsArr,
      route_code:      routeCode,
      ship_to:         shipsArr[0] || "",
      avgangstid:      avgangstid || "",
      nasta_dag:       nastaDag,
      min_fore_avgang: minFore,
      zon,
      kbana,
      count:           e.count,
      after_hours:     e.afterHours,
      before_work:     e.beforeWork,
      hours:           e.hours,
      times:           sortedTimes,
      first_time:      firstTime,
      orsak:           dagOrsak,
      kommentar:       "",
      kontroll_scans:  st ? st.kontroll : 0,
      kontroll_total:  st ? st.total    : 0,
      events:          e.events, // används vid upsert till scans-tabellen
    });
  }

  return { records, datum: detDatum, error: null };
}

/**
 * Läser en X08-fil (ArrayBuffer) och returnerar parseX08-resultatet.
 */
export async function readX08File(file) {
  const buf = await file.arrayBuffer();
  const wb  = XLSX.read(buf, { type: "array", cellDates: true });
  return parseX08(wb);
}

// ─── Rader-parser ────────────────────────────────────────────────────────────

/**
 * Parsar rader-rapport (plockade rader per station) till { datum, zon1, zon2, zon3 }.
 * Returnerar { rader, datum, error }.
 */
export function parseRader(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows  = fillMergedCells(sheet, XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }));

  let hIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].map((c) => String(c ?? "").toLowerCase().trim());
    // Kräv att "station" och "rader" är SEPARATA celler — inte substrängar av samma cell
    // (t.ex. "RPT_Rader-Backar per Station" ska inte matcha)
    const hasStation = cells.some((c) => c === "station");
    const hasRader   = cells.some((c) => c === "rader" || c === "antal");
    if (hasStation && hasRader) { hIdx = i; break; }
  }
  if (hIdx === -1) return { rader: null, datum: null, error: "Hittade ingen station/rader-rubrikrad." };

  const headers    = rows[hIdx].map((c) => String(c ?? "").toLowerCase().trim());
  const stationCol = colIdx(headers, "station");
  const raderCol   = colIdx(headers, "rader", "antal");
  const datumCol   = colIdx(headers, "datum", "date");

  if (raderCol === -1) return { rader: null, datum: null, error: "Hittar inte rader-kolumn." };

  const dataRows = rows.slice(hIdx + 1).filter((r) => String(r[stationCol] ?? "").trim() !== "");
  if (dataRows.length === 0) return { rader: null, datum: null, error: "Inga datarader hittades." };

  // Parsa datum — hanterar YYYY-MM-DD, YYYYMMDD (JDE-format) och Excel-serienummer
  const parseDatumCell = (v) => {
    if (!v && v !== 0) return null;
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{8}$/.test(s)) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
    return excelDateToISO(v);
  };

  let detDatum = null;
  if (datumCol !== -1 && dataRows[0]) {
    detDatum = parseDatumCell(dataRows[0][datumCol]);
  }

  const zonRader = { zon1: 0, zon2: 0, zon3: 0 };
  for (const r of dataRows) {
    const z     = stationToZon(r[stationCol]);
    const antal = parseInt(r[raderCol], 10) || 0;
    if (z === "1") zonRader.zon1 += antal;
    else if (z === "2") zonRader.zon2 += antal;
    else if (z === "3") zonRader.zon3 += antal;
  }

  return { rader: zonRader, datum: detDatum, error: null };
}

export async function readRaderFile(file) {
  const buf = await file.arrayBuffer();
  const wb  = XLSX.read(buf, { type: "array", cellDates: true });
  return parseRader(wb);
}

// ─── Backup-parser (importera från exporterad Excel) ─────────────────────────

/**
 * Parsar en Excel-fil som exporterats från AvvikelseLive (Historik → Exportera Excel).
 * Returnerar { records, error }.
 */
export function parseBackupFile(workbook) {
  // Normalisera sheetnamn för robustare jämförelse (hanterar å/ä/ö-encoding-varianter)
  const norm = (s) => String(s).normalize("NFC").toLowerCase().replace(/\s+/g, "");

  // 1. Hitta flik via namn
  const findByName = (...names) => {
    for (const n of names) {
      const match = workbook.SheetNames.find((s) => norm(s) === norm(n));
      if (match) return workbook.Sheets[match];
    }
    return null;
  };

  // 2. Fallback: skanna alla flikar efter en som har VNR + Datum
  const findByColumns = () => {
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      if (rows.length > 0 && "VNR" in rows[0] && "Datum" in rows[0]) return sheet;
    }
    return null;
  };

  const sheet =
    findByName("Rådata", "Radata", "Rådata", "rådata") ||
    findByName("Per avvikelse", "Peravvikelse") ||
    findByColumns() ||
    workbook.Sheets[workbook.SheetNames[0]];

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  if (rows.length === 0) return { records: [], error: "Filen verkar tom." };

  const first = rows[0];
  if (!("VNR" in first) || !("Datum" in first)) {
    return {
      records: [],
      error: `Hittade inte kolumnerna VNR och Datum. Flikar i filen: ${workbook.SheetNames.join(", ")}. Kolumner på första fliken: ${Object.keys(first).slice(0, 8).join(", ")}.`,
    };
  }

  // "Zon"-kolumnen kan komma in som "Zon 2" — strippa prefixet
  const cleanZon = (v) => String(v ?? "").trim().replace(/^Zon\s+/i, "") || null;

  const records = rows
    .filter((r) => r["VNR"] && r["Datum"])
    .map((r) => ({
      datum:           String(r["Datum"]).trim().slice(0, 10),
      vnr:             String(r["VNR"]).trim(),
      locations:       r["Lagerplats"] ? String(r["Lagerplats"]).split(", ").map((s) => s.trim()).filter(Boolean) : [],
      zon:             cleanZon(r["Zon"]),
      kbana:           String(r["K-bana"] ?? "").trim() || "",
      route_code:      String(r["Tur"] ?? "").trim() || "",
      avgangstid:      String(r["Avgångstid"] ?? "").trim() || "",
      min_fore_avgang: r["Min före avg"] !== "" && r["Min före avg"] !== null ? parseInt(r["Min före avg"], 10) || null : null,
      nasta_dag:       String(r["Avgångstid"] ?? "").toLowerCase().includes("nästa dag"),
      count:           parseInt(r["Antal"], 10) || 1,
      orsak:           String(r["Orsak"] ?? "").trim() || "",
      kommentar:       String(r["Kommentar"] ?? "").trim() || "",
      kontroll_scans:  0,
      kontroll_total:  0,
      after_hours:     0,
      before_work:     0,
      hours:           [],
      times:           [],
    }));

  if (records.length === 0) return { records: [], error: "Inga giltiga rader hittades i filen." };
  return { records, error: null };
}

export async function readBackupFile(file) {
  const buf = await file.arrayBuffer();
  const wb  = XLSX.read(buf, { type: "array" });
  return parseBackupFile(wb);
}

// ─── Auto-detektering av filtyp ──────────────────────────────────────────────

/**
 * Läser en fil och returnerar 'x08' | 'rader' | 'backup'.
 * Används för att låta användaren bara dra in en fil utan att välja typ manuellt.
 */
export async function detectFileType(file) {
  const buf = await file.arrayBuffer();
  const wb  = XLSX.read(buf, { type: "array" });
  const norm = (s) => String(s).normalize("NFC").toLowerCase().replace(/\s+/g, "");

  // Backup: har Rådata- eller Per avvikelse-flik
  const backupNames = ["rådata", "radata", "peravvikelse", "per avvikelse"];
  if (wb.SheetNames.some((s) => backupNames.includes(norm(s)))) return "backup";

  // Rader: någon flik har rubrikrad där "station" och "rader"/"antal" är separata celler
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
    for (const row of rows) {
      const cells = row.map((c) => String(c ?? "").toLowerCase().trim());
      if (cells.some((c) => c === "station") && cells.some((c) => c === "rader" || c === "antal")) {
        return "rader";
      }
    }
  }

  return "x08";
}

// ─── Whitelist för deviations-kolumner (skyddar mot skräpfält vid upsert) ────

export const DEVIATION_COLUMNS = [
  "datum", "vnr", "locations", "zon", "kbana", "route_code", "ship_to",
  "avgangstid", "nasta_dag", "min_fore_avgang", "count", "after_hours",
  "before_work", "hours", "times", "orsak", "kommentar",
  "kontroll_scans", "kontroll_total", "user_id",
];

export function cleanDeviationRow(row, { keepId = false } = {}) {
  const out = {};
  for (const k of DEVIATION_COLUMNS) {
    if (row[k] !== undefined) out[k] = row[k];
  }
  if (keepId && row.id) out.id = row.id;
  return out;
}

// ─── Merge-logik ─────────────────────────────────────────────────────────────

/**
 * Slår samman inkommande records med befintliga för samma datum.
 * Bevarar manuellt satt orsak och kommentar — ersätter bara om orsak var tom/"Okänd".
 *
 * @param {Array} existing  - befintliga deviations från Supabase (för aktuellt datum)
 * @param {Array} incoming  - parsade records från readX08File
 * @returns {Array}         - mergade records redo för upsert, med flaggorna `alreadyExists`
 */
export function mergeDeviations(existing, incoming) {
  const byVnr = new Map(existing.map((r) => [r.vnr, r]));
  return incoming.map((rec) => {
    const prev = byVnr.get(rec.vnr);
    if (!prev) return { ...rec, alreadyExists: false };
    // Bevara manuell orsak om den var meningsfull
    const keepOrsak = prev.orsak && prev.orsak !== "Okänd";
    return {
      ...rec,
      orsak:      keepOrsak ? prev.orsak      : (rec.orsak || prev.orsak || ""),
      kommentar:  prev.kommentar || rec.kommentar,
      alreadyExists: true,
    };
  });
}
