import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase.js";

export function useRader() {
  const [rader, setRader] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    // PostgREST har en server-side max_rows (default 1000) som limit() inte kan overrida.
    // Paginera istället tills svaret är kortare än PAGE_SIZE.
    const PAGE_SIZE = 1000;
    let allData = [];
    let from = 0;
    while (true) {
      const { data } = await supabase
        .from("rader")
        .select("*")
        .order("datum", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      allData = allData.concat(data ?? []);
      if (!data || data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    // Normalisera datum direkt — Supabase kan returnera "2026-05-20T00:00:00+00:00"
    setRader(allData.map((r) => ({ ...r, datum: String(r.datum).slice(0, 10) })));
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

async function upsertRader(row) {
  const d = String(row?.datum || "").slice(0, 10);
  if (!d) throw new Error("Kan inte spara rader utan datum.");
  // Strippa DB-genererade kolumner — annars följer de med via spread
  // när anroparen skickar in en tidigare hämtad rad.
  const { id, user_id, created_at, updated_at, ...rest } = row;
  const { error } = await supabase
    .from("rader")
    .upsert({ ...rest, datum: d }, { onConflict: "org_id,datum" });
  if (error) throw new Error(error.message);
  await fetch();
}

  function getRaderForDatum(datum) {
    const key = String(datum).slice(0, 10);
    return rader.find((r) => String(r.datum).slice(0, 10) === key)
      ?? { zon1: 0, zon2: 0, zon3: 0, total: 0 };
  }

  return { rader, loading, upsertRader, getRaderForDatum, refetch: fetch };
}
