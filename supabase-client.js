import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./supabase-config.js";

const configured = Boolean(supabaseConfig.url && supabaseConfig.anonKey);

window.coconibzBackend = {
  configured,
  client: configured
    ? createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
    : null,
};
