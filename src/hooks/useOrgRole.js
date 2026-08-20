import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase.js";

export function useOrgRole() {
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    supabase
      .from("org_members")
      .select("role")
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setRole(data?.role ?? null);
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  return { role, isAdmin: role === "admin", loading };
}
