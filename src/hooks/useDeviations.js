import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase.js";

// fromDate/toDate are the same server-side bound every "date range" tab
// already applies client-side after fetching everything — passing them
// through to the query means the server does the filtering instead of
// shipping the whole (unboundedly growing) table just to discard most of
// it in the browser. Omit both to fetch everything, same as before —
// tabs with a genuine "see all history" feature (cleared date field, "All"
// option) keep working, since that's just fromDate/toDate coming back empty.
export function useDeviations({ datum, fromDate, toDate } = {}) {
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
        if (fromDate) q = q.gte("datum", fromDate);
        if (toDate) q = q.lte("datum", toDate);
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
  }, [datum, fromDate, toDate]);

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
  // Strippa id/user_id ur varje rad — Postgres sätter dem via defaults,
  // men bara om kolumnerna är helt frånvarande i anropet.
  const payload = rows.map(({ id, user_id, ...rest }) => rest);

  const { error: err } = await supabase
    .from("deviations")
    .upsert(payload, { onConflict: "org_id,datum,vnr" });
  if (err) throw new Error(err.message);
  await fetch();
}

  return { deviations, loading, error, refetch: fetch, updateOrsak, updateKommentar, upsertMany };
}
