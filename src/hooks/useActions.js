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
    const { data, error } = await supabase
      .from('actions')
      .select('*')
      .order('datum', { ascending: false });
    if (error) setError(error.message);
    else setActions(data || []);
    setLoading(false);
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
