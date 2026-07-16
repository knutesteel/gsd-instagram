import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase =
  url && key ? createClient(url, key, { auth: { persistSession: true } }) : null;

export const supabaseConfigured = Boolean(supabase);
