// Supabase Edge Function: privileged user-provisioning operations that the
// mobile app must never do itself (it never holds the service-role key).
// Deploy with: supabase functions deploy admin-users
//
// Called from src/store/useStore.ts's addUser/addUsersBulk/updateUser
// (password branch) actions, gated to super_admin per PRD §2 ("Account
// provisioning, org configuration" is Super Admin-only) — re-checked here
// server-side too, since this function's own client uses the service-role
// key and therefore bypasses RLS entirely by design.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// The app calls this function from the browser (Expo web) as well as native,
// so preflight OPTIONS requests must get a CORS-friendly response or the
// browser blocks the real request before it's ever sent.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type CreateBody = {
  action: 'create';
  username: string;
  password: string;
  name: string;
  role: string;
  teamId: string | null;
  city?: string;
  phone?: string;
};

type SetPasswordBody = {
  action: 'setPassword';
  userId: string;
  password: string;
};

type Body = CreateBody | SetPasswordBody;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    // Client bound to the CALLER's JWT, used only to verify who they are.
    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user: caller },
      error: userErr,
    } = await callerClient.auth.getUser();
    if (userErr || !caller) return json({ error: 'Not authenticated' }, 401);

    const { data: callerProfile, error: profileErr } = await callerClient
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .single();
    if (profileErr || callerProfile?.role !== 'super_admin') {
      return json({ error: 'Forbidden: super_admin only' }, 403);
    }

    // Elevated client for the actual privileged operation. Every call here —
    // including the bulk-provisioning path (PRD §13, 215-account scale) —
    // goes through this same single-user createUser under the hood; there is
    // no batch-create API, so the app-side addUsersBulk() loops one request
    // per row against this endpoint rather than this function batching them.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const body = (await req.json()) as Body;

    if (body.action === 'create') {
      const email = `${body.username.trim().toLowerCase()}@internal.spc`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: body.password,
        email_confirm: true,
        user_metadata: {
          name: body.name,
          username: body.username,
          role: body.role,
          team_id: body.teamId,
          city: body.city ?? null,
          phone: body.phone ?? null,
        },
      });
      if (error) return json({ error: error.message }, 400);
      return json({ id: data.user.id });
    }

    if (body.action === 'setPassword') {
      const { error } = await admin.auth.admin.updateUserById(body.userId, { password: body.password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: 'Unknown action' }, 400);
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
