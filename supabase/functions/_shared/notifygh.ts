export interface NotifyghResponse {
  id?: string;
  status?: string;
  recipientCount?: number;
  failedCount?: number;
  recipients?: Array<{
    phoneNumber?: string;
    status?: string;
    error?: string | null;
  }>;
}

export async function sendNotifyghMessage(
  message: string,
  recipients: string[],
): Promise<NotifyghResponse> {
  const apiKey = Deno.env.get("NOTIFYGH_API_KEY");
  if (!apiKey) throw new Error("NotifyGH is not configured on the server.");

  const senderId = Deno.env.get("NOTIFYGH_SENDER_ID");
  const response = await fetch("https://notifygh.com/api/v1/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      recipients,
      ...(senderId ? { senderId } : {}),
    }),
    signal: AbortSignal.timeout(15000),
  });

  let result: NotifyghResponse = {};
  try {
    result = await response.json();
  } catch {
    throw new Error(`NotifyGH returned an unreadable response (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    const reason = response.status === 401
      ? "Check the NotifyGH API key."
      : response.status === 402
        ? "The NotifyGH wallet may need a top-up."
        : response.status === 422
          ? "Check that the sender ID is approved."
          : `NotifyGH returned HTTP ${response.status}.`;
    throw new Error(reason);
  }
  if (result.status === "failed") {
    throw new Error("NotifyGH could not accept this SMS.");
  }

  return result;
}

export function normalizeGhanaPhone(phone: string): string {
  const compact = phone.trim().replace(/[()\s-]/g, "");
  if (/^0[0-9]{9}$/.test(compact)) return `+233${compact.slice(1)}`;
  if (/^233[0-9]{9}$/.test(compact)) return `+${compact}`;
  if (/^\+233[0-9]{9}$/.test(compact)) return compact;
  throw new Error("Enter a valid Ghanaian mobile number.");
}
