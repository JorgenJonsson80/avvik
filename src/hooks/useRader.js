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
    const { error } = await supabase
      .from("rader")
      .upsert(row, { onConflict: "user_id,datum" });
    if (error) throw new Error(error.message);
    await fetch();
  }

  function getRaderForDatum(datum) {
    const key = String(datum).slice(0, 10);
    return rader.find((r) => String(r.datum).slice(0, 10) === key)
      ?? { zon1: 0, zon2: 0, zon3: 0 };
  }

  return { rader, loading, upsertRader, getRaderForDatum, refetch: fetch };
}
