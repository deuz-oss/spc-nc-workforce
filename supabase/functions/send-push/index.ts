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

    // Confirms the caller is a real authenticated user. This function is
    // callable directly (not only after a successful messages insert), so it
    // must authorize on its own: the caller has to share a conversation with
    // the recipient, and the notification title is the caller's real profile
    // name — never a client-supplied string, which would allow spoofed pushes.
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
    // Interpolated into a PostgREST filter below — must be a bare uuid.
    if (!/^[0-9a-f-]{36}$/i.test(body.recipientUserId)) {
      return json({ error: 'Invalid recipientUserId' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: shared } = await admin
      .from('conversations')
      .select('id')
      .or(
        `and(participant_a.eq.${caller.id},participant_b.eq.${body.recipientUserId}),` +
          `and(participant_a.eq.${body.recipientUserId},participant_b.eq.${caller.id})`,
      )
      .limit(1);
    if (!shared?.length) return json({ error: 'Forbidden: no conversation with recipient' }, 403);

    const { data: sender } = await admin.from('profiles').select('name, active').eq('id', caller.id).single();
    if (!sender?.active) return json({ error: 'Forbidden' }, 403);

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
        title: sender.name,
        body: String(body.body).slice(0, 200),
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
