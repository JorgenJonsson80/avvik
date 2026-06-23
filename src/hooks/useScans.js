import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase.js";

export function useScans(deviationId) {
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!deviationId) { setScans([]); return; }
    setLoading(true);
    supabase
      .from("scans")
      .select("*")
      .eq("deviation_id", deviationId)
      .order("tid")
      .then(({ data }) => {
        setScans(data ?? []);
        setLoading(false);
      });
  }, [deviationId]);

  async function updateScanOrsak(scanId, orsak) {
    const { error } = await supabase
      .from("scans")
      .update({ orsak })
      .eq("id", scanId);
    if (error) throw new Error(error.message);
    setScans((prev) => prev.map((s) => (s.id === scanId ? { ...s, orsak } : s)));
  }

  return { scans, loading, updateScanOrsak };
}
