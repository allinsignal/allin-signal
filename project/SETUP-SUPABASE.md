# Allin Signal — Supabase backend setup

This walks you through standing up the real backend. Takes about 10 minutes.

---

## 1. Create your Supabase project

1. Go to **[supabase.com](https://supabase.com)** and sign up (free).
2. **New project** → name it `allin-signal`, pick a region close to your users, set a strong database password (save it — you'll need it later).
3. Wait ~2 minutes for provisioning.

---

## 2. Run the schema

1. In the Supabase dashboard, open **SQL Editor** (left sidebar) → **New query**.
2. Open `supabase/schema.sql` from this project, copy the whole file, and paste it into the editor.
3. Click **Run**.

You should see: `Success. No rows returned`. That creates four tables (`profiles`, `signals`, `watchlist_items`, `rating_changes`), enables Row Level Security on all of them, and seeds 12 demo signals so the UI has something to show.

To verify: open **Table Editor** in the sidebar — you should see all four tables and 12 rows in `signals`.

---

## 3. Wire your keys into the site

1. In Supabase, go to **Project Settings → API**.
2. Copy two values:
   - **Project URL** — looks like `https://abcdwxyz.supabase.co`
   - **anon / public key** — long string starting with `eyJ...`
3. Open `js/supabase-client.js` in this project and replace the two placeholder strings:
   ```js
   const SUPABASE_URL  = 'https://YOUR-PROJECT-REF.supabase.co';
   const SUPABASE_ANON = 'YOUR-ANON-PUBLIC-KEY';
   ```
4. Save. Reload the site. You're connected.

> The **anon key** is safe to ship to the browser. Your data is protected by the RLS policies the schema set up — users can only see their own profile and watchlist, and only subscribers see the full signals list.

---

## 4. Confirm email setup

By default Supabase requires email confirmation on signup.

- **Quickest for testing:** Dashboard → **Authentication → Providers → Email** → toggle off **Confirm email**. Now signups are instant.
- **For production:** Dashboard → **Authentication → Email Templates** → customize the confirmation email so it says "Allin Signal" and links to `allinsignal.com`.

---

## 5. Try it out

1. Open `index.html` (or your live URL).
2. Click **Sign in** in the top right → switch to **Create account** → use a test email + password.
3. Go to **Watchlist** → you should see an empty list. Search a ticker like `NRTH` and click **Add**. It now persists in Supabase.
4. Check Supabase → **Table Editor → watchlist_items** — your row is there.

---

## 6. Make yourself a "subscriber" (for testing member features)

Until payments are wired (next step below), flip your own subscription flag manually so you can see the member-only views:

1. Supabase → **Table Editor → profiles** → find your row.
2. Set `is_subscribed` to `true`. Save.
3. Reload. You can now see the full signals list.

---

## What's still left to build

Backend foundation is done. To turn this into a real $3/mo business:

- **Payments (Stripe).** Stripe Checkout + a Supabase Edge Function webhook that flips `profiles.is_subscribed = true` after a successful charge. ~1 hour.
- **The scan job.** A scheduled function (Supabase cron, GitHub Actions, or your own server) that fetches weekly closes, runs your model, and `UPSERT`s into `signals` + writes flip events to `rating_changes`. This is the part where your secret strategy lives — write it in whatever language you're comfortable with and call Supabase via the service-role key.
- **Email alerts.** A second cron that scans `rating_changes` joined to `watchlist_items WHERE alerts_enabled = true` and sends emails via Resend or Postmark.
- **Custom domain.** Point `allinsignal.com` at Netlify/Cloudflare Pages. (See chat — covered earlier.)

Say the word and I'll set up Stripe + the webhook next.

---

## Files this added

| Path | Purpose |
|---|---|
| `supabase/schema.sql` | Database schema + RLS policies + seed data |
| `js/supabase-client.js` | Initialized Supabase JS client + helper functions (`window.allin`) |
| `js/auth.js` | Shared sign-in/sign-up modal, auto-wired to "Sign in" buttons |
| `SETUP-SUPABASE.md` | This file |
