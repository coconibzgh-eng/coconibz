(() => {
  const config = window.COCONIBZ_SUPABASE_CONFIG;
  const configured = Boolean(config?.url && config?.anonKey && window.supabase?.createClient);

  window.coconibzBackend = {
    configured,
    client: configured
      ? window.supabase.createClient(config.url, config.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
      : null,
  };
})();
