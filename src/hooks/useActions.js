// ============================================================================
// useActions.js — CRUD för åtgärder mot Supabase
// ----------------------------------------------------------------------------
// Följer samma form som useDeviations: en fetch vid mount + insert/delete som
// uppdaterar local state optimistiskt. user_id sätts server-side via
// default auth.uid(), så vi skickar aldrig med det själva.
// ============================================================================
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';

export function useActions() {
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchActions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Same PostgREST server-side max_rows (default 1000) as useDeviations —
      // paginate instead of a bare select(), or this silently truncates
      // (not just costs bandwidth) once actions passes 1000 rows.
      const PAGE_SIZE = 1000;
      let allData = [];
      let from = 0;
      while (true) {
        const { data, error: err } = await supabase
          .from('actions')
          .select('*')
          .order('datum', { ascending: false })
          .range(from, from + PAGE_SIZE - 1);
        if (err) { setError(err.message); break; }
        allData = allData.concat(data ?? []);
        if (!data || data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
      setActions(allData);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActions();
  }, [fetchActions]);

  // Lägg till en åtgärd. Returnerar den skapade raden (med id från DB).
  const addAction = useCallback(async ({ vnr, datum, text, av, location, kbana }) => {
    const { data, error } = await supabase
      .from('actions')
      .insert({ vnr, datum, text, av, location, kbana })
      .select()
      .single();
    if (error) {
      setError(error.message);
      return null;
    }
    setActions((prev) => [data, ...prev]);
    return data;
  }, []);

  const deleteAction = useCallback(async (id) => {
    const { error } = await supabase.from('actions').delete().eq('id', id);
    if (error) {
      setError(error.message);
      return;
    }
    setActions((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return { actions, loading, error, addAction, deleteAction, refetch: fetchActions };
}
