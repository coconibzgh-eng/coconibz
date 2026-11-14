import { createClient } from "npm:@supabase/supabase-js@2";
import { sendNotifyghMessage } from "../_shared/notifygh.ts";

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
  if (!authorization || !apiKey || !supabaseUrl) {
    return jsonResponse({ error: "Sign in before requesting an SMS." }, 401);
  }

  const client = createClient(supabaseUrl, apiKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userResult, error: userError } = await client.auth.getUser();
  if (userError || !userResult.user) return jsonResponse({ error: "Your session is invalid. Sign in again." }, 401);

  let body: { order_id?: string; kind?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "The SMS request is invalid." }, 400);
  }
  if (!body.order_id || !/^[0-9a-f-]{36}$/i.test(body.order_id)) {
    return jsonResponse({ error: "Choose a valid order." }, 400);
  }

  const { data: order, error: orderError } = await client
    .from("orders")
    .select("id,customer_id,customer_name,customer_phone,shop_id,fulfillment,status,financial_status,total")
    .eq("id", body.order_id)
    .maybeSingle();
  if (orderError || !order) return jsonResponse({ error: "The order could not be found or accessed." }, 404);

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("role")
    .eq("id", userResult.user.id)
    .single();
  if (profileError) return jsonResponse({ error: "Could not verify your account permissions." }, 403);

  let notificationType: string;
  let eventKey: string;
  let message: string;

  if (body.kind === "order_confirmation") {
    if (order.customer_id !== userResult.user.id || order.status !== "pending") {
      return jsonResponse({ error: "You cannot send a confirmation for this order." }, 403);
    }
    notificationType = "order_confirmation";
    eventKey = order.id;
    message = `Hi ${order.customer_name}, we received your COCONIBZ order #${order.id.slice(0, 8)}. Total: GHS ${order.total}. We will send updates when its status changes.`;
  } else if (body.kind === "order_status") {
    if (!["admin", "retailer"].includes(profile.role)) {
      return jsonResponse({ error: "Only assigned shop staff can send order status updates." }, 403);
    }
    if (profile.role === "retailer") {
      if (!order.shop_id) return jsonResponse({ error: "Retailers cannot update delivery orders." }, 403);
      const { data: hasShopAccess, error: accessError } = await client.rpc("has_coconibz_shop_access", {
        target_shop_id: order.shop_id,
      });
      if (accessError || !hasShopAccess) return jsonResponse({ error: "You are not assigned to this order's shop." }, 403);
    }
    notificationType = "order_status";
    eventKey = order.status;
    const service = order.fulfillment === "delivery" ? "delivery" : "pickup";
    const statusMessage: Record<string, string> = {
      confirmed: "has been confirmed",
      preparing: "is being prepared",
      ready: order.fulfillment === "delivery" ? "is ready for delivery" : "is ready for pickup",
      completed: order.fulfillment === "delivery" ? "has been delivered" : "has been completed",
      cancelled: "has been cancelled",
      pending: "is pending confirmation",
    };
    if (!statusMessage[order.status]) return jsonResponse({ error: "This order status cannot be sent by SMS." }, 400);
    message = `Hi ${order.customer_name}, your COCONIBZ ${service} order #${order.id.slice(0, 8)} ${statusMessage[order.status]}.`;
  } else if (body.kind === "payment_update") {
    if (profile.role !== "admin") return jsonResponse({ error: "Only admins can send payment updates." }, 403);
    notificationType = "payment_update";
    eventKey = order.financial_status;
    message = `Hi ${order.customer_name}, the payment status for COCONIBZ order #${order.id.slice(0, 8)} is ${order.financial_status}. Order total: GHS ${order.total}.`;
  } else {
    return jsonResponse({ error: "Choose a supported notification type." }, 400);
  }

  const { data: notificationId, error: claimError } = await client.rpc("coconibz_claim_order_sms", {
    p_order_id: order.id,
    p_notification_type: notificationType,
    p_event_key: eventKey,
  });
  if (claimError) return jsonResponse({ error: claimError.message }, 403);
  if (!notificationId) return jsonResponse({ sent: false, duplicate: true });

  let result;
  try {
    result = await sendNotifyghMessage(message, [order.customer_phone]);
    if (
      result.status === "partially_failed" ||
      result.failedCount === 1 ||
      result.recipients?.some((recipient) =>
        recipient.status === "failed" || recipient.status === "undelivered"
      )
    ) {
      throw new Error("NotifyGH could not send this message.");
    }
  } catch (error) {
    const { error: finishError } = await client.rpc("coconibz_finish_order_sms", {
      p_notification_id: notificationId,
      p_status: "failed",
      p_provider_message_id: null,
    });
    if (finishError) return jsonResponse({ error: "The SMS failed and its delivery record could not be updated." }, 502);
    return jsonResponse({ error: error instanceof Error ? error.message : "The SMS could not be sent." }, 502);
  }

  const { error: finishError } = await client.rpc("coconibz_finish_order_sms", {
    p_notification_id: notificationId,
    p_status: "sent",
    p_provider_message_id: result.id || null,
  });
  if (finishError) {
    return jsonResponse({ error: "NotifyGH accepted the SMS, but its delivery record could not be saved." }, 502);
  }
  return jsonResponse({ sent: true });
});
