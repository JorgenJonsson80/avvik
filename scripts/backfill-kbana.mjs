#!/usr/bin/env node
// backfill-kbana.mjs
// Engångsskript. Den felaktiga K61-36→K55-sammanslagningen (commit a49ed4d, 2026-09-03)
// gjorde att rader importerade sedan dess fick kbana "K55" även för station-36-platser
// utan P3-träff — de ska vara "K61-36". classifyLocation är återställd; det här rättar
// de redan lagrade raderna i deviations (och K-bana-texten i actions).
//
// Ändrar ENBART K55 → K61-36, och bara när samma regel som importen (dominant plats =
// flest scans) ger K61-36. Allt annat lämnas orört; rader som inte går att avgöra
// listas för manuell granskning.
//
// Torrkörning som standard — inget skrivs. Kör från projektroten:
//   node --env-file=.env.local scripts/backfill-kbana.mjs            # torrkörning
//   node --env-file=.env.local scripts/backfill-kbana.mjs --apply    # skriv (frågar först)
//   ... --verbose                                                    # lista alla rader
//
// Loggar in med samma e-post/lösenord som appen (anon-nyckel → samma RLS, ingen
// service-nyckel). Sätt AVV_EMAIL / AVV_PASSWORD för att slippa prompten.

import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import readline from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";
import { classifyLocation } from "../src/lib/classify.js";

const WRONG = "K55";     // vad merge-commiten skrev
const RIGHT = "K61-36";  // vad reglerna ger
const PAGE  = 1000;      // PostgREST max_rows
const CHUNK = 100;       // id:n per .in()-anrop

// ─── Ren logik (testad i tests/backfillKbana.test.js) ────────────────────────

const classesOf = (locations) => new Set((locations ?? []).map((l) => classifyLocation(l) || ""));

// Kandidat: lagrat K55, men minst en plats klassas K61-36 enligt reglerna.
export function isCandidate(dev) {
  return classesOf(dev.locations).has(RIGHT);
}

// Blandade K-banor bland platserna → dominant plats kräver scans.
export function needsScans(dev) {
  return classesOf(dev.locations).size > 1;
}

// Vilken K-bana skulle importen gett? Samma regel som importParser: dominant plats
// (flest scans) avgör. null = går inte att avgöra (inga scans, eller jämnt lopp
// mellan olika K-banor — scan-ordningen som importen bröt lika på finns inte kvar).
export function recomputeKbana(dev, scans = []) {
  const cls = classesOf(dev.locations);
  if (cls.size === 1) return [...cls][0] || null;

  const counts = new Map();
  for (const s of scans) if (s.location) counts.set(s.location, (counts.get(s.location) ?? 0) + 1);
  const max = Math.max(0, ...counts.values());
  if (max === 0) return null;
  const top = new Set([...counts].filter(([, n]) => n === max).map(([loc]) => classifyLocation(loc) || ""));
  return top.size === 1 ? [...top][0] || null : null;
}

// fix = ska bli K61-36. ambiguous = kan inte avgöras (granska manuellt).
// Övriga kandidater har en dominant plats som inte är K61-36 → lagrat värde rörs inte.
export function planDeviationFixes(deviations, scansByDev = new Map()) {
  const fix = [], ambiguous = [];
  for (const dev of deviations.filter(isCandidate)) {
    const kbana = recomputeKbana(dev, scansByDev.get(dev.id));
    if (kbana === RIGHT) fix.push(dev);
    else if (kbana === null) ambiguous.push(dev);
  }
  return { fix, ambiguous };
}

// En åtgärd har bara en plats → ingen dominans att avgöra.
export function planActionFixes(actions) {
  return actions.filter((a) => classifyLocation(a.location) === RIGHT);
}

// ─── I/O ─────────────────────────────────────────────────────────────────────

async function fetchAll(build) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

async function fetchScansFor(supabase, devs) {
  const byDev = new Map();
  for (let i = 0; i < devs.length; i += CHUNK) {
    const ids = devs.slice(i, i + CHUNK).map((d) => d.id);
    const rows = await fetchAll(() => supabase.from("scans").select("deviation_id, location").in("deviation_id", ids));
    for (const r of rows) {
      if (!byDev.has(r.deviation_id)) byDev.set(r.deviation_id, []);
      byDev.get(r.deviation_id).push(r);
    }
  }
  return byDev;
}

async function updateKbana(supabase, table, ids) {
  let done = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    // .eq("kbana", WRONG): rör inget som ändrats sedan läsningen.
    const { data, error } = await supabase.from(table).update({ kbana: RIGHT })
      .in("id", ids.slice(i, i + CHUNK)).eq("kbana", WRONG).select("id");
    if (error) throw new Error(`${table}: ${error.message}`);
    done += data.length;
  }
  return done;
}

async function ask(question, { hidden = false } = {}) {
  if (!hidden || !process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try { return (await rl.question(question)).trim(); } finally { rl.close(); }
  }
  // Dolt lösenord: raw mode, inget eko.
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
    let buf = "";
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === "\u0003") process.exit(130);                                  // Ctrl-C
        if (c === "\r" || c === "\n") {
          stdin.setRawMode(false); stdin.pause(); stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(buf);
        }
        buf = c === "\u007f" || c === "\b" ? buf.slice(0, -1) : buf + c;
      }
    };
    stdin.on("data", onData);
  });
}

// ─── Körning ─────────────────────────────────────────────────────────────────

async function main() {
  const APPLY   = process.argv.includes("--apply");
  const VERBOSE = process.argv.includes("--verbose");

  const url = process.env.VITE_SUPABASE_URL, key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Saknar VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — kör: node --env-file=.env.local scripts/backfill-kbana.mjs");
  }
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const email    = process.env.AVV_EMAIL || await ask("E-post: ");
  const password = process.env.AVV_PASSWORD || await ask("Lösenord: ", { hidden: true });
  const { error: authErr } = await supabase.auth.signInWithPassword({ email, password });
  if (authErr) throw new Error(`Inloggning misslyckades: ${authErr.message}`);
  console.log(`Inloggad som ${email} mot ${new URL(url).host} — ${APPLY ? "SKRIVLÄGE" : "torrkörning, inget skrivs"}\n`);

  const devs       = await fetchAll(() => supabase.from("deviations").select("id, datum, vnr, kbana, locations").eq("kbana", WRONG));
  const candidates = devs.filter(isCandidate);
  const scansByDev = await fetchScansFor(supabase, candidates.filter(needsScans));
  const { fix: devFix, ambiguous } = planDeviationFixes(candidates, scansByDev);
  const actFix     = planActionFixes(await fetchAll(() => supabase.from("actions").select("id, datum, vnr, location, kbana").eq("kbana", WRONG)));

  const show = (rows, fmt) => {
    for (const r of VERBOSE ? rows : rows.slice(0, 10)) console.log(`  ${fmt(r)}`);
    if (!VERBOSE && rows.length > 10) console.log(`  … och ${rows.length - 10} till (--verbose visar alla)`);
  };

  console.log(`deviations med kbana ${WRONG}: ${devs.length} st, varav ${devFix.length} ska bli ${RIGHT}`);
  const perDatum = {};
  for (const d of devFix) perDatum[d.datum] = (perDatum[d.datum] ?? 0) + 1;
  for (const [d, n] of Object.entries(perDatum).sort()) console.log(`  ${d}: ${n} st`);
  show(devFix, (d) => `${d.datum}  ${d.vnr}  ${(d.locations ?? []).join(", ")}`);

  console.log(`\nåtgärder (actions) som ska bli ${RIGHT}: ${actFix.length} st`);
  show(actFix, (a) => `${a.datum}  ${a.vnr}  ${a.location}`);

  if (ambiguous.length > 0) {
    console.log(`\n⚠ ${ambiguous.length} deviations kunde INTE avgöras (blandade platser utan scans, eller jämnt lopp) — rörs inte:`);
    for (const d of ambiguous) console.log(`  ${d.datum}  ${d.vnr}  ${(d.locations ?? []).join(", ")}`);
  }

  if (devFix.length + actFix.length === 0) {
    console.log("\nInget att rätta.");
  } else if (!APPLY) {
    console.log("\nTorrkörning klar — inget skrevs. Kör igen med --apply för att skriva.");
  } else {
    const answer = await ask(`\nSkriv JA för att ändra ${devFix.length} deviations och ${actFix.length} åtgärder från ${WRONG} till ${RIGHT}: `);
    if (answer !== "JA") {
      console.log("Avbrutet — inget skrevs.");
    } else {
      // Ångerfil: id:n som ändras, så att det kan backas (set kbana = 'K55' where id in …).
      const undoFile = new URL(`backfill-kbana-undo-${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.json`, import.meta.url);
      writeFileSync(undoFile, JSON.stringify({ from: WRONG, to: RIGHT, deviations: devFix.map((d) => d.id), actions: actFix.map((a) => a.id) }, null, 2));
      console.log(`Ångerfil: ${fileURLToPath(undoFile)}`);

      const nDev = await updateKbana(supabase, "deviations", devFix.map((d) => d.id));
      const nAct = await updateKbana(supabase, "actions", actFix.map((a) => a.id));
      console.log(`Uppdaterade ${nDev}/${devFix.length} deviations och ${nAct}/${actFix.length} åtgärder.`);
      if (nDev !== devFix.length || nAct !== actFix.length) {
        console.log("⚠ Färre än väntat uppdaterades — något ändrades under körningen eller RLS stoppade det. Kör torrkörning igen.");
      }
    }
  }
  await supabase.auth.signOut();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(`\nFel: ${err.message}`); process.exit(1); });
}
