import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase.js";

export function useDeviations({ datum } = {}) {
  const [deviations, setDeviations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    let q = supabase
      .from("deviations")
      .select("*")
      .order("datum", { ascending: false })
      .order("vnr")
      .limit(100000); // PostgREST default cap är 1000 — sätt högt för historik
    if (datum) q = q.eq("datum", datum);
    const { data, error: err } = await q;
    if (err) setError(err.message);
    else setDeviations(data ?? []);
    setLoading(false);
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
