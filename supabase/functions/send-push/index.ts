// Supabase Edge Function: sends an Expo push notification to one recipient
// user by looking up their stored push token (profiles.push_token) with the
// service-role key. The mobile app never talks to Expo's push API directly
// (no reason to hold the recipient's token client-side) — it calls this
// function after successfully inserting a chat message (see
// src/store/useStore.ts's sendMessage action).
//
// Deploy with: supabase functions deploy send-push
//
// NOT verified end-to-end — no physical device/EAS project is available in
// this environment to confirm a real Expo push token round-trips through
// Expo's push service. Structure mirrors admin-users/index.ts (the one
// existing, working edge function) closely, but treat this as unverified
// until tested against a real build.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Body = { recipientUserId: string; title: string; body: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    // Confirms the caller is a real authenticated user. The actual
    // authorization for "may this person message this recipient" already
    // happened at the messages_insert RLS layer before the app ever calls
    // this function — this is just push delivery, not a second permission gate.
    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user: caller },
      error: userErr,
    } = await callerClient.auth.getUser();
    if (userErr || !caller) return json({ error: 'Not authenticated' }, 401);

    const body = (await req.json()) as Body;
    if (!body.recipientUserId || !body.body) {
      return json({ error: 'Missing recipientUserId/body' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: recipient, error: recErr } = await admin
      .from('profiles')
      .select('push_token')
      .eq('id', body.recipientUserId)
      .single();

    if (recErr || !recipient?.push_token) {
      // Not an error from the caller's point of view — the recipient may
      // simply never have granted notification permission. Fire-and-forget.
      return json({ sent: false, reason: 'no push token on file for recipient' });
    }

    const expoRes = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        to: recipient.push_token,
        title: body.title,
        body: body.body,
        sound: 'default',
      }),
    });
    const expoJson = await expoRes.json().catch(() => null);
    return json({ sent: expoRes.ok, expo: expoJson });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
