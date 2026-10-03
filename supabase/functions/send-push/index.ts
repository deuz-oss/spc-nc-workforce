// Supabase Edge Function: sends an Expo push notification to one recipient
// user, to every device token registered for them (push_tokens, migration
// 0015 — readable only with the service-role key). The mobile app never talks to Expo's push API directly
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

/** `conversationId` (optional for older app builds) lets a tap on the
 * notification open that chat thread. */
type Body = { recipientUserId: string; title: string; body: string; conversationId?: string };

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

    let q = admin
      .from('conversations')
      .select('id')
      .or(
        `and(participant_a.eq.${caller.id},participant_b.eq.${body.recipientUserId}),` +
          `and(participant_a.eq.${body.recipientUserId},participant_b.eq.${caller.id})`,
      );
    // When named, the conversation must be exactly one between these two.
    if (body.conversationId) q = q.eq('id', String(body.conversationId));
    const { data: shared } = await q.limit(1);
    if (!shared?.length) return json({ error: 'Forbidden: no conversation with recipient' }, 403);
    const conversationId = shared[0].id as string;

    const { data: sender } = await admin.from('profiles').select('name, active').eq('id', caller.id).single();
    if (!sender?.active) return json({ error: 'Forbidden' }, 403);

    const { data: tokens, error: tokErr } = await admin
      .from('push_tokens')
      .select('token')
      .eq('user_id', body.recipientUserId);

    if (tokErr || !tokens?.length) {
      // Not an error from the caller's point of view — the recipient may
      // simply never have granted notification permission. Fire-and-forget.
      return json({ sent: false, reason: 'no push token on file for recipient' });
    }

    const to = tokens.map((t) => t.token as string);
    const expoRes = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(
        to.map((token) => ({
          to: token,
          title: sender.name,
          body: String(body.body).slice(0, 200),
          sound: 'default',
          // Read by the app to open the thread when the notification is tapped.
          data: { type: 'chat', conversationId },
        })),
      ),
    });
    const expoJson = await expoRes.json().catch(() => null);

    // Tickets come back in request order. DeviceNotRegistered = app uninstalled
    // or token rotated: drop the token so it isn't tried (and leaked to) forever.
    const tickets: Array<{ status?: string; details?: { error?: string } }> = Array.isArray(expoJson?.data) ? expoJson.data : [];
    const dead = to.filter((_, i) => tickets[i]?.status === 'error' && tickets[i]?.details?.error === 'DeviceNotRegistered');
    if (dead.length) await admin.from('push_tokens').delete().in('token', dead);

    return json({ sent: expoRes.ok, devices: to.length, removed: dead.length });
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
