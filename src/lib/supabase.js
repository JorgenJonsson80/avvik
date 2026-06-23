import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error(
    "Saknar VITE_SUPABASE_URL eller VITE_SUPABASE_ANON_KEY i .env.local"
  );
}

export const supabase = createClient(url, key);
