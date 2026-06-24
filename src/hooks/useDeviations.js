import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase.js";

export function useDeviations({ datum } = {}) {
  const [deviations, setDeviations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // PostgREST har en server-side max_rows (default 1000) som limit() inte kan overrida.
      // Paginera istället tills svaret är kortare än PAGE_SIZE.
      const PAGE_SIZE = 1000;
      let allData = [];
      let from = 0;
      while (true) {
        let q = supabase
          .from("deviations")
          .select("*")
          .order("datum", { ascending: false })
          .order("vnr")
          .range(from, from + PAGE_SIZE - 1);
        if (datum) q = q.eq("datum", datum);
        const { data, error: err } = await q;
        if (err) { setError(err.message); break; }
        allData = allData.concat(data ?? []);
        if (!data || data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
      setDeviations(allData);
    } finally {
      setLoading(false);
    }
  }, [datum]);

  useEffect(() => { fetch(); }, [fetch]);

  async function updateOrsak(id, orsak) {
    const { error: err } = await supabase
      .from("deviations")
      .update({ orsak, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (err) throw new Error(err.message);
    setDeviations((prev) =>
      prev.map((d) => (d.id === id ? { ...d, orsak } : d))
    );
  }

  async function updateKommentar(id, kommentar) {
    const { error: err } = await supabase
      .from("deviations")
      .update({ kommentar, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (err) throw new Error(err.message);
    setDeviations((prev) =>
      prev.map((d) => (d.id === id ? { ...d, kommentar } : d))
    );
  }

  async function upsertMany(rows) {
    const { error: err } = await supabase
      .from("deviations")
      .upsert(rows, { onConflict: "user_id,datum,vnr" });
    if (err) throw new Error(err.message);
    await fetch();
  }

  return { deviations, loading, error, refetch: fetch, updateOrsak, updateKommentar, upsertMany };
}
