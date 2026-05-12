// =====================================================================
// Allin Signal · stripe-webhook Edge Function
// =====================================================================
// Receives Stripe events and syncs subscription status to Supabase.
//
// Setup in Stripe Dashboard:
//   Developers → Webhooks → Add endpoint
//   URL: https://<your-project>.supabase.co/functions/v1/stripe-webhook
//   Events: checkout.session.completed, customer.subscription.deleted
// =====================================================================

Deno.serve(async (req) => {
  const SB_URL     = Deno.env.get("SUPABASE_URL")!;
  const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

  const sbHeaders = {
    "apikey": SB_SERVICE,
    "Authorization": `Bearer ${SB_SERVICE}`,
    "Content-Type": "application/json",
  };

  // Verify Stripe signature
  const sig = req.headers.get("stripe-signature");
  const body = await req.text();

  if (!sig || !STRIPE_WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "Missing signature" }), { status: 400 });
  }

  // Stripe signature verification (HMAC-SHA256)
  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    event = await verifyStripeSignature(body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return new Response(JSON.stringify({ error: `Signature invalid: ${e}` }), { status: 400 });
  }

  const obj = event.data.object as Record<string, unknown>;

  if (event.type === "checkout.session.completed") {
    const email = (obj.customer_details as Record<string, string>)?.email
      || (obj as Record<string, string>).customer_email;

    if (!email) {
      return new Response(JSON.stringify({ error: "No email in event" }), { status: 400 });
    }

    // Find the user by email via admin API
    const userRes = await fetch(
      `${SB_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
      { headers: sbHeaders }
    );
    const userJson = await userRes.json() as { users?: Array<{ id: string }> };
    const userId = userJson?.users?.[0]?.id;

    if (!userId) {
      // User hasn't signed up yet — store pending subscription by email
      // They'll get unlocked when they create an account
      console.log(`No Supabase user found for ${email} — storing pending`);
      await fetch(`${SB_URL}/rest/v1/pending_subscriptions`, {
        method: "POST",
        headers: { ...sbHeaders, "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify({ email, subscribed_at: new Date().toISOString() }),
      });
      return new Response(JSON.stringify({ ok: true, status: "pending", email }));
    }

    // Mark profile as subscribed
    const upsertRes = await fetch(`${SB_URL}/rest/v1/profiles`, {
      method: "POST",
      headers: { ...sbHeaders, "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify({
        id: userId,
        email,
        is_subscribed: true,
        subscribed_at: new Date().toISOString(),
      }),
    });

    if (!upsertRes.ok) {
      const err = await upsertRes.text();
      return new Response(JSON.stringify({ error: err }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true, status: "subscribed", email }));
  }

  if (event.type === "customer.subscription.deleted") {
    const custEmail = (obj as Record<string, string>).customer_email;
    if (custEmail) {
      const userRes = await fetch(
        `${SB_URL}/auth/v1/admin/users?email=${encodeURIComponent(custEmail)}`,
        { headers: sbHeaders }
      );
      const userJson = await userRes.json() as { users?: Array<{ id: string }> };
      const userId = userJson?.users?.[0]?.id;
      if (userId) {
        await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${userId}`, {
          method: "PATCH",
          headers: sbHeaders,
          body: JSON.stringify({ is_subscribed: false }),
        });
      }
    }
    return new Response(JSON.stringify({ ok: true, status: "unsubscribed" }));
  }

  return new Response(JSON.stringify({ ok: true, status: "ignored", type: event.type }));
});

// Stripe HMAC-SHA256 signature verification for Deno
async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string
): Promise<{ type: string; data: { object: Record<string, unknown> } }> {
  const parts = Object.fromEntries(
    header.split(",").map(p => p.split("=") as [string, string])
  );
  const timestamp = parts["t"];
  const signature = parts["v1"];

  if (!timestamp || !signature) throw new Error("Malformed stripe-signature header");

  const signed = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signed));
  const expected = Array.from(new Uint8Array(mac))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  if (expected !== signature) throw new Error("Signature mismatch");

  // Replay attack protection: reject events older than 5 minutes
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp);
  if (age > 300) throw new Error("Timestamp too old");

  return JSON.parse(payload);
}
