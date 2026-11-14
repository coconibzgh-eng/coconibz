import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const authorization = request.headers.get("Authorization");
  const apiKey = request.headers.get("apikey");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authorization || !apiKey || !supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "The customer deletion service is not configured." }, 500);
  }

  const userClient = createClient(supabaseUrl, apiKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userResult, error: userError } = await userClient.auth.getUser();
  if (userError || !userResult.user) return jsonResponse({ error: "Your session is invalid. Sign in again." }, 401);

  const { data: adminProfile, error: adminError } = await userClient
    .from("profiles")
    .select("role")
    .eq("id", userResult.user.id)
    .single();
  if (adminError || adminProfile.role !== "admin") {
    return jsonResponse({ error: "Only admins can delete customer accounts." }, 403);
  }

  let body: { user_id?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "The customer deletion request is invalid." }, 400);
  }
  if (!body.user_id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.user_id)) {
    return jsonResponse({ error: "Choose a valid customer account." }, 400);
  }
  if (body.user_id === userResult.user.id) {
    return jsonResponse({ error: "You cannot delete the signed-in admin account here." }, 400);
  }

  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: customer, error: customerError } = await serviceClient
    .from("profiles")
    .select("id,role")
    .eq("id", body.user_id)
    .maybeSingle();
  if (customerError) return jsonResponse({ error: "Could not load the customer account." }, 500);
  if (!customer) return jsonResponse({ error: "Customer account not found." }, 404);
  if (customer.role !== "customer") return jsonResponse({ error: "Only customer accounts can be deleted here." }, 403);

  const { data: anonymizedOrderCount, error: anonymizeError } = await serviceClient.rpc(
    "coconibz_anonymize_customer",
    { p_customer_id: customer.id },
  );
  if (anonymizeError) {
    return jsonResponse({ error: `Could not anonymize the customer's records: ${anonymizeError.message}` }, 500);
  }

  const storage = serviceClient.storage.from("profile-photos");
  const photoPaths: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data: photos, error: listError } = await storage.list(customer.id, { limit: 100, offset });
    if (listError) {
      return jsonResponse({
        error: "Order history was anonymized, but profile photos could not be listed. The account remains; retry deletion.",
      }, 502);
    }
    photoPaths.push(...(photos || [])
      .filter((photo) => photo.id)
      .map((photo) => `${customer.id}/${photo.name}`));
    if (!photos || photos.length < 100) break;
  }

  if (photoPaths.length) {
    const { error: photoError } = await storage.remove(photoPaths);
    if (photoError) {
      return jsonResponse({
        error: "Order history was anonymized, but profile photos could not be removed. The account remains; retry deletion.",
      }, 502);
    }
  }

  const { error: deleteError } = await serviceClient.auth.admin.deleteUser(customer.id);
  if (deleteError) {
    return jsonResponse({
      error: "Order history was anonymized and profile photos removed, but the login could not be deleted. Retry deletion.",
    }, 502);
  }

  return jsonResponse({ deleted: true, anonymized_order_count: anonymizedOrderCount || 0 });
});
