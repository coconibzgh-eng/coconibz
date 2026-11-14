import { Webhook } from "npm:standardwebhooks@1.0.0";
import { sendNotifyghMessage } from "../_shared/notifygh.ts";

const jsonHeaders = { "Content-Type": "application/json" };

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed.", { status: 405 });
  }

  const secret = Deno.env.get("SEND_SMS_HOOK_SECRETS")?.replace(/^v1,whsec_/, "");
  if (!secret) {
    return Response.json({ error: "The SMS hook is not configured." }, { status: 500 });
  }

  let payload: { user?: { phone?: string }; sms?: { otp?: string } };
  try {
    const body = await request.text();
    const webhook = new Webhook(secret);
    payload = webhook.verify(body, Object.fromEntries(request.headers)) as typeof payload;
  } catch {
    return Response.json({ error: "The SMS hook signature is invalid." }, { status: 401 });
  }

  const phone = payload.user?.phone;
  const otp = payload.sms?.otp;
  if (!phone || !otp || !/^[0-9]{4,8}$/.test(otp)) {
    return Response.json({ error: "The SMS hook payload is invalid." }, { status: 400 });
  }

  try {
    const result = await sendNotifyghMessage(
      `Your COCONIBZ verification code is ${otp}. Do not share this code with anyone.`,
      [phone],
    );
    if (
      result.status === "failed" ||
      result.status === "partially_failed" ||
      result.failedCount === 1 ||
      result.recipients?.some((recipient) =>
        recipient.status === "failed" || recipient.status === "undelivered"
      )
    ) {
      throw new Error("NotifyGH could not send the verification message.");
    }
    return new Response(null, { status: 200 });
  } catch {
    return Response.json(
      { error: "The verification SMS could not be sent. Please try again later." },
      { status: 502, headers: jsonHeaders },
    );
  }
});
