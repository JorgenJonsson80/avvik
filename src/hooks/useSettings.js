import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase.js";

const DEFAULTS = { goal: 2.0, cost: 63, time_min: 13 };

export function useSettings() {
  const [settings, setSettings] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("settings")
      .select("*")
      .maybeSingle()
      .then(({ data }) => {
        if (data) setSettings(data);
        setLoading(false);
      });
  }, []);

  async function save(patch) {
    const updated = { ...settings, ...patch };
    const { error } = await supabase
      .from("settings")
      .upsert(updated, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    setSettings(updated);
  }

  return { settings, loading, save };
}
