const env = import.meta.env;

export const supabaseConfig = Object.freeze({
  url: env["VITE_SUPABASE_URL"] || "",
  anonKey: env["VITE_SUPABASE_ANON_KEY"] || "",
});
