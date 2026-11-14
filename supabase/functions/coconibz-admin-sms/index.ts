import { createClient } from "npm:@supabase/supabase-js@2";
import { normalizeGhanaPhone, sendNotifyghMessage } from "../_shared/notifygh.ts";

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
    return jsonResponse({ error: "The SMS service is not configured." }, 500);
  }

  const userClient = createClient(supabaseUrl, apiKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userResult, error: userError } = await userClient.auth.getUser();
  if (userError || !userResult.user) return jsonResponse({ error: "Your session is invalid. Sign in again." }, 401);

  const { data: profile, error: profileError } = await userClient
    .from("profiles")
    .select("role")
    .eq("id", userResult.user.id)
    .single();
  if (profileError || profile.role !== "admin") {
    return jsonResponse({ error: "Only admins can send manual or promotional SMS messages." }, 403);
  }

  let body: { kind?: string; phone?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "The SMS request is invalid." }, 400);
  }
  const message = body.message?.trim();
  if (!message || message.length > 1000) {
    return jsonResponse({ error: "Write a message of 1 to 1,000 characters." }, 400);
  }

  let recipients: string[];
  if (body.kind === "manual") {
    try {
      recipients = [normalizeGhanaPhone(body.phone || "")];
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : "Enter a valid phone number." }, 400);
    }
  } else if (body.kind === "promotion") {
    const serviceClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { count, error: countError } = await serviceClient
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "customer")
      .eq("sms_marketing_opt_in", true);
    if (countError || count === null) return jsonResponse({ error: "Could not count opted-in customers." }, 500);
    if (!count) return jsonResponse({ error: "No customers have opted in to promotional SMS." }, 400);
    if (count > 5000) {
      return jsonResponse({ error: "This audience exceeds NotifyGH's 5,000-recipient request limit. No messages were sent." }, 400);
    }

    const optedInCustomers: Array<{ phone: string }> = [];
    for (let offset = 0; offset < count; offset += 1000) {
      const { data, error: customersError } = await serviceClient
        .from("profiles")
        .select("phone")
        .eq("role", "customer")
        .eq("sms_marketing_opt_in", true)
        .order("created_at", { ascending: false })
        .range(offset, Math.min(offset + 999, count - 1));
      if (customersError) return jsonResponse({ error: "Could not load all opted-in customers. No messages were sent." }, 500);
      optedInCustomers.push(...(data || []));
    }
    if (optedInCustomers.length !== count) {
      return jsonResponse({ error: "The opted-in customer list changed while it was loading. No messages were sent; please try again." }, 409);
    }
    try {
      recipients = [...new Set(optedInCustomers.map((customer) => normalizeGhanaPhone(customer.phone)))];
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : "A customer phone number is invalid. No messages were sent." }, 400);
    }
    if (recipients.length !== count) {
      return jsonResponse({ error: "Some opted-in accounts share a phone number. No messages were sent." }, 409);
    }
  } else {
    return jsonResponse({ error: "Choose manual or promotional SMS." }, 400);
  }

  try {
    const result = await sendNotifyghMessage(message, recipients);
    const failedCount = result.failedCount ?? (result.status === "partially_failed" ? 1 : 0);
    if (failedCount >= recipients.length) {
      throw new Error("NotifyGH could not deliver the message to any recipient.");
    }
    return jsonResponse({
      sent: true,
      recipientCount: result.recipientCount ?? recipients.length,
      failedCount,
      providerMessageId: result.id ?? null,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "The SMS could not be sent." }, 502);
  }
});
