import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase.js";

export function useRader() {
  const [rader, setRader] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("rader")
      .select("*")
      .order("datum", { ascending: false });
    // Normalisera datum direkt — Supabase kan returnera "2026-05-20T00:00:00+00:00"
    setRader((data ?? []).map((r) => ({ ...r, datum: String(r.datum).slice(0, 10) })));
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
