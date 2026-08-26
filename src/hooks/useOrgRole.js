import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase.js";

export function useOrgRole() {
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    supabase
      .from("org_members")
      .select("role")
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (!active) return;
        if (err) {
          console.error("useOrgRole: kunde inte hämta org-roll", err);
          setError(err.message);
        }
        setRole(data?.role ?? null);
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  return { role, isAdmin: role === "admin", loading, error };
}
