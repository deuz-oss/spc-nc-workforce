/**
 * RLS / RPC / edge-function smoke test against a real Supabase project.
 *
 * Signs in as the seeded demo accounts (scripts/seed-supabase.ts) and checks
 * that each role can do what it should and — more importantly — cannot do
 * what 0008_audit_hardening.sql, 0009_targets_uniqueness.sql and
 * 0010_scheduled_scorecards.sql forbid. Every
 * row it creates is tagged `smoke_<run>` and deleted in a finally block with
 * the service-role key, including when a check fails.
 *
 * It WRITES to the project in .env, so it refuses to run unless you name that
 * project explicitly:
 *
 *   npm run smoke -- --project <project-ref>
 *
 * (<project-ref> is the subdomain of EXPO_PUBLIC_SUPABASE_URL.) Point it at a
 * staging/demo project that has had `npm run seed:supabase` run — never at
 * production data. Exit code 1 if any check fails.
 */
import 'dotenv/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { buildSeed } from '../src/store/seed';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in .env.');
  process.exit(1);
}

const projectRef = new URL(url).hostname.split('.')[0];
const argIdx = process.argv.indexOf('--project');
if (argIdx === -1 || process.argv[argIdx + 1] !== projectRef) {
  console.error(
    `Refusing to run: this script writes test rows to ${url}.\n` +
      `Re-run with the matching project ref to confirm:  npm run smoke -- --project ${projectRef}`,
  );
  process.exit(1);
}

const RUN = `smoke_${Date.now().toString(36)}`;
const TEST_PERIOD = '2000-01'; // far-past period so scorecard/target writes never touch real months
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, noSession);

// --- tiny test harness -------------------------------------------------------

type Outcome = 'PASS' | 'FAIL' | 'SKIP';
const results: Array<{ name: string; outcome: Outcome; detail?: string }> = [];

class Skip extends Error {}

async function check(name: string, fn: () => Promise<void | string>) {
  try {
    const note = await fn();
    results.push({ name, outcome: 'PASS', detail: note || undefined });
  } catch (e) {
    const outcome: Outcome = e instanceof Skip ? 'SKIP' : 'FAIL';
    results.push({ name, outcome, detail: e instanceof Error ? e.message : String(e) });
  }
}

function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** Asserts a write was refused: either an error, or (for UPDATE/DELETE with no
 * matching policy) zero affected rows. */
function expectDenied(res: { error: any; data?: any }, what: string) {
  if (res.error) return;
  expect(Array.isArray(res.data) && res.data.length === 0, `${what} was ALLOWED (expected denial)`);
}

function expectOk(res: { error: any }, what: string) {
  expect(!res.error, `${what} failed: ${res.error?.message} (${res.error?.code ?? 'no code'})`);
}

// --- cleanup registry --------------------------------------------------------

const created = {
  authUsers: [] as string[],
  attendances: [] as string[],
  visits: [] as string[],
  stockTaking: [] as string[],
  consumers: [] as string[],
  conversations: [] as string[],
  targets: [] as string[],
  certifications: [] as string[],
  photos: [] as string[],
};

async function cleanup() {
  const del = async (table: string, ids: string[]) => {
    if (!ids.length) return;
    const { error } = await admin.from(table).delete().in('id', ids);
    if (error) console.warn(`  cleanup ${table}: ${error.message}`);
  };
  if (created.photos.length) {
    const { error } = await admin.storage.from('report-media').remove(created.photos);
    if (error) console.warn(`  cleanup photos: ${error.message}`);
  }
  await del('conversations', created.conversations); // messages cascade
  await del('stock_taking', created.stockTaking);
  await del('visits', created.visits);
  await del('attendances', created.attendances); // route_points cascade
  await del('consumers', created.consumers);
  await del('targets', created.targets);
  await del('certifications', created.certifications);
  {
    const { error } = await admin.from('scorecards').delete().eq('period_key', TEST_PERIOD);
    if (error) console.warn(`  cleanup scorecards: ${error.message}`);
  }
  for (const id of created.authUsers) {
    const { error } = await admin.auth.admin.deleteUser(id); // profile cascades
    if (error) console.warn(`  cleanup auth user ${id}: ${error.message}`);
  }
}

// --- helpers -------------------------------------------------------------------

async function signIn(username: string, password: string): Promise<{ client: SupabaseClient; id: string }> {
  const client = createClient(url!, anonKey!, noSession);
  const { data, error } = await client.auth.signInWithPassword({ email: `${username}@internal.spc`, password });
  if (error || !data.user) throw new Error(`sign-in as ${username} failed: ${error?.message}`);
  return { client, id: data.user.id };
}

/** Status code of a failed functions.invoke (FunctionsHttpError keeps the Response in `context`). */
function fnStatus(error: any): number | undefined {
  return error?.context?.status;
}

// --- main ----------------------------------------------------------------------

async function main() {
  console.log(`Smoke test ${RUN} against ${url}\n`);
  const seed = buildSeed();
  const pw = (u: string) => {
    const s = seed.users.find((x) => x.username === u);
    if (!s) throw new Error(`demo user ${u} missing from seed.ts`);
    return s.password;
  };

  const superadmin = await signIn('superadmin', pw('superadmin'));
  const analyst = await signIn('analyst', pw('analyst'));
  const pm = await signIn('pm', pw('pm'));
  const reckitt = await signIn('reckitt', pw('reckitt'));
  const tl = await signIn('tl.jaksel', pw('tl.jaksel'));
  const nc = await signIn('nc.budi', pw('nc.budi'));
  const trainer = await signIn('trainer', pw('trainer'));

  const { data: team } = await admin.from('teams').select('id, tl_id, arco_id').eq('id', 't_jaksel').single();
  const { data: stores } = await admin.from('stores').select('id').in('id', ['st_demo1', 'st_demo2']);
  expect(team && stores?.length === 2, 'demo team t_jaksel / stores st_demo1+st_demo2 not found — run `npm run seed:supabase` first');

  // ===== 1. Provisioning ======================================================

  await check('self-signup cannot obtain a working (active) account', async () => {
    const anon = createClient(url!, anonKey!, noSession);
    const username = `${RUN}_signup`;
    const { data, error } = await anon.auth.signUp({
      email: `${username}@internal.spc`,
      password: 'Smoke-test-123',
      options: { data: { username, name: 'Smoke Signup', role: 'super_admin', team_id: 't_jaksel' } },
    });
    if (error) {
      // Only a signup-disabled error proves anything. GoTrue also rejects
      // undeliverable domains like @internal.spc ("email_address_invalid") —
      // an attacker would just use a real address, so that is inconclusive.
      if ((error as any).code === 'signup_disabled' || /signups? not allowed/i.test(error.message)) {
        return 'public signup is disabled ✓';
      }
      throw new Skip(
        `inconclusive — signup rejected for another reason (${error.message}). Verify manually that ` +
          'Authentication → Providers → Email → "Allow new users to sign up" is OFF.',
      );
    }
    if (data.user) created.authUsers.push(data.user.id);
    const { data: prof } = await admin.from('profiles').select('active, team_id').eq('id', data.user!.id).single();
    expect(prof && prof.active === false, 'self-signed-up profile is ACTIVE — 0008 trigger not applied');
    expect(prof.team_id === null, 'self-signed-up profile got a team from user metadata');
    return 'profile created inactive — but public signup is still ENABLED in Auth settings; disable it';
  });

  let nc2: { client: SupabaseClient; id: string } | null = null;
  const nc2Username = `${RUN}_nc2`;
  const nc2Password = 'Smoke-test-123';

  await check('admin-users edge function creates + activates an NC', async () => {
    const { data, error } = await superadmin.client.functions.invoke('admin-users', {
      body: { action: 'create', username: nc2Username, password: nc2Password, name: 'Smoke NC 2', role: 'nc', teamId: 't_jaksel' },
    });
    if (error) throw new Error(`invoke failed (status ${fnStatus(error) ?? '?'}) — is admin-users deployed? ${error.message}`);
    expect(data?.id, `no id returned: ${JSON.stringify(data)}`);
    created.authUsers.push(data.id);
    const { data: prof } = await admin.from('profiles').select('role, team_id, active').eq('id', data.id).single();
    expect(prof?.active && prof.role === 'nc' && prof.team_id === 't_jaksel', `profile not provisioned: ${JSON.stringify(prof)}`);
  });

  // Fallback so the remaining checks still run if the edge function isn't deployed.
  if (!(await admin.from('profiles').select('id').eq('username', nc2Username)).data?.length) {
    const { data, error } = await admin.auth.admin.createUser({
      email: `${nc2Username}@internal.spc`,
      password: nc2Password,
      email_confirm: true,
      user_metadata: { username: nc2Username, name: 'Smoke NC 2' },
    });
    if (!error && data.user) {
      created.authUsers.push(data.user.id);
      await admin.from('profiles').update({ role: 'nc', team_id: 't_jaksel', active: true }).eq('id', data.user.id);
    }
  }
  try {
    nc2 = await signIn(nc2Username, nc2Password);
  } catch (e) {
    console.warn(`  could not sign in second NC: ${(e as Error).message}`);
  }

  await check('admin-users rejects a non-super_admin caller', async () => {
    const { error } = await nc.client.functions.invoke('admin-users', {
      body: { action: 'create', username: `${RUN}_x`, password: 'Smoke-test-123', name: 'x', role: 'super_admin', teamId: null },
    });
    if (fnStatus(error) === 404) throw new Skip('admin-users not deployed');
    expect(error && fnStatus(error) === 403, `expected 403, got ${fnStatus(error) ?? 'success'}`);
  });

  await check('deactivated user loses RLS rights with a still-valid JWT', async () => {
    if (!nc2) throw new Skip('second NC unavailable');
    await admin.from('profiles').update({ active: false }).eq('id', nc2.id);
    try {
      const id = `${RUN}_a_deact`;
      const res = await nc2.client
        .from('attendances')
        .insert({ id, user_id: nc2.id, clock_in_lat: -6.2, clock_in_lng: 106.8, geo_fence_ok: true });
      if (!res.error) created.attendances.push(id);
      expect(res.error, 'deactivated NC could still clock in');
    } finally {
      await admin.from('profiles').update({ active: true }).eq('id', nc2.id);
    }
  });

  // ===== 2. Field data integrity (NC) =========================================

  const attId = `${RUN}_a`;
  const visitId = `${RUN}_v`;
  const stkId = `${RUN}_stk`;
  const checkIn = new Date(Date.now() - 60 * 60000); // 1h ago

  await check('NC can clock in, check in, and submit a report for the visit store', async () => {
    const a = await nc.client.from('attendances').insert({
      id: attId, user_id: nc.id, clock_in_at: checkIn.toISOString(), clock_in_lat: -6.2, clock_in_lng: 106.8, geo_fence_ok: true,
    });
    expectOk(a, 'clock-in');
    created.attendances.push(attId);
    const v = await nc.client.from('visits').insert({
      id: visitId, store_id: 'st_demo1', nc_id: nc.id, check_in_at: checkIn.toISOString(), lat: -6.2, lng: 106.8, store_distance_m: 10, geo_valid: true,
    });
    expectOk(v, 'visit insert');
    created.visits.push(visitId);
    const s = await nc.client.from('stock_taking').insert({ id: stkId, visit_id: visitId, store_id: 'st_demo1', sku: 'SMOKE', qty_on_hand: 5 });
    expectOk(s, 'stock taking insert');
    created.stockTaking.push(stkId);
  });

  await check('NC cannot file a report under a different store than the visit', async () => {
    const id = `${RUN}_stk_wrong`;
    const res = await nc.client.from('stock_taking').insert({ id, visit_id: visitId, store_id: 'st_demo2', sku: 'SMOKE', qty_on_hand: 1 });
    if (!res.error) created.stockTaking.push(id);
    expect(res.error, 'report accepted with a store_id that does not match the visit');
  });

  await check('NC cannot edit or delete a submitted report', async () => {
    expectDenied(await nc.client.from('stock_taking').update({ qty_on_hand: 999 }).eq('id', stkId).select(), 'update');
    expectDenied(await nc.client.from('stock_taking').delete().eq('id', stkId).select(), 'delete');
    const { data } = await admin.from('stock_taking').select('qty_on_hand').eq('id', stkId).single();
    expect(Number(data?.qty_on_hand) === 5, `row changed to ${data?.qty_on_hand}`);
  });

  await check('NC cannot rewrite a visit (e.g. flip geo_valid) or delete it', async () => {
    expectDenied(await nc.client.from('visits').update({ geo_valid: false, store_distance_m: 9999 }).eq('id', visitId).select(), 'visit update');
    expectDenied(await nc.client.from('visits').delete().eq('id', visitId).select(), 'visit delete');
  });

  await check('another NC cannot report against this NC’s visit', async () => {
    if (!nc2) throw new Skip('second NC unavailable');
    const id = `${RUN}_stk_other`;
    const res = await nc2.client.from('stock_taking').insert({ id, visit_id: visitId, store_id: 'st_demo1', sku: 'SMOKE', qty_on_hand: 1 });
    if (!res.error) created.stockTaking.push(id);
    expect(res.error, 'foreign NC report accepted');
  });

  await check('finish_visit keeps the offline check-out time and is idempotent', async () => {
    const offline = new Date(checkIn.getTime() + 20 * 60000);
    expectOk(await nc.client.rpc('finish_visit', { p_visit_id: visitId, p_check_out_at: offline.toISOString() }), 'finish_visit');
    const first = (await admin.from('visits').select('check_out_at').eq('id', visitId).single()).data?.check_out_at;
    expect(first && Math.abs(new Date(first).getTime() - offline.getTime()) < 2000, `check_out_at=${first}, expected ${offline.toISOString()}`);
    expectOk(await nc.client.rpc('finish_visit', { p_visit_id: visitId, p_check_out_at: new Date().toISOString() }), 'replayed finish_visit');
    const second = (await admin.from('visits').select('check_out_at').eq('id', visitId).single()).data?.check_out_at;
    expect(second === first, 'replay overwrote the check-out time');
  });

  await check('clock-in fields are immutable; clock-out still works', async () => {
    const tamper = await nc.client.from('attendances').update({ clock_in_at: new Date(Date.now() - 5 * 3600000).toISOString() }).eq('id', attId).select();
    expect(tamper.error || !tamper.data?.length, 'clock_in_at was rewritten');
    expectOk(await nc.client.from('attendances').update({ clock_out_at: new Date().toISOString(), clock_out_lat: -6.2, clock_out_lng: 106.8 }).eq('id', attId), 'clock-out');
  });

  await check('evidence photos are private: no anonymous URL; signed URL for the TL, refused for another NC', async () => {
    const path = `${visitId}/${RUN}.png`;
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expectOk(await nc.client.storage.from('report-media').upload(path, png, { contentType: 'image/png' }), 'NC photo upload');
    created.photos.push(path);

    const publicUrl = admin.storage.from('report-media').getPublicUrl(path).data.publicUrl;
    const anon = await fetch(publicUrl);
    expect(anon.status !== 200, `photo readable anonymously via public URL (HTTP ${anon.status}) — 0011 not applied`);

    const signed = await tl.client.storage.from('report-media').createSignedUrl(path, 60);
    expect(!signed.error && signed.data?.signedUrl, `TL could not get a signed URL: ${signed.error?.message}`);
    expect((await fetch(signed.data!.signedUrl)).status === 200, 'signed URL did not serve the photo');

    if (nc2) {
      const other = await nc2.client.storage.from('report-media').createSignedUrl(path, 60);
      expect(other.error, 'another NC got a signed URL for this NC’s evidence photo');
    }
  });

  // ===== 3. Consumer PII ======================================================

  const consumerId = `${RUN}_cons`;
  await check('NC can create a consumer and read it back', async () => {
    const res = await nc.client.from('consumers').insert({
      id: consumerId, name: 'Smoke Consumer', wa_contact: '080000000000', consent: true, child_age_bracket: '1-2tahun', created_by_nc_id: nc.id,
    });
    expectOk(res, 'consumer insert');
    created.consumers.push(consumerId);
    const { data } = await nc.client.from('consumers').select('id').eq('id', consumerId);
    expect(data?.length === 1, 'creator cannot see their own new consumer');
  });

  const seesConsumer = async (c: SupabaseClient) => ((await c.from('consumers').select('id').eq('id', consumerId)).data?.length ?? 0) === 1;

  await check('Reckitt cannot read consumer PII', async () => {
    expect(!(await seesConsumer(reckitt.client)), 'reckitt_client can read consumer name/WhatsApp');
  });
  await check('PM and the NC’s TL can read the consumer', async () => {
    expect(await seesConsumer(pm.client), 'PM cannot see consumer');
    expect(await seesConsumer(tl.client), 'TL cannot see own team NC’s consumer');
  });
  await check('an unrelated NC cannot read the consumer', async () => {
    if (!nc2) throw new Skip('second NC unavailable');
    expect(!(await seesConsumer(nc2.client)), 'another NC can read this consumer');
  });

  // ===== 4. Chat ==============================================================

  const convoId = `${RUN}_cv`;
  await check('NC can see their TL profile and open an NC↔TL chat', async () => {
    if (!team!.tl_id) throw new Skip('team t_jaksel has no tl_id');
    const { data } = await nc.client.from('profiles').select('id').eq('id', team!.tl_id);
    expect(data?.length === 1, 'NC cannot see their TL’s profile (chat list would be empty)');
    const res = await nc.client.from('conversations').insert({ id: convoId, type: 'nc_tl', participant_a: nc.id, participant_b: team!.tl_id });
    expectOk(res, 'conversation insert');
    created.conversations.push(convoId);
  });

  await check('NC cannot open a chat with an arbitrary user (PM)', async () => {
    const id = `${RUN}_cv_bad`;
    const res = await nc.client.from('conversations').insert({ id, type: 'nc_tl', participant_a: nc.id, participant_b: pm.id });
    if (!res.error) created.conversations.push(id);
    expect(res.error, 'NC↔PM conversation accepted');
  });

  await check('read receipts persist via mark_messages_read', async () => {
    if (!created.conversations.includes(convoId)) throw new Skip('no conversation');
    expectOk(await tl.client.from('messages').insert({ id: `${RUN}_msg`, conversation_id: convoId, sender_id: tl.id, body: 'smoke' }), 'TL message');
    expectOk(await nc.client.rpc('mark_messages_read', { p_conversation_id: convoId }), 'mark_messages_read');
    const { data } = await admin.from('messages').select('read_at').eq('id', `${RUN}_msg`).single();
    expect(data?.read_at, 'read_at still null');
  });

  await check('send-push refuses a recipient the caller has no conversation with', async () => {
    const { error } = await nc.client.functions.invoke('send-push', { body: { recipientUserId: pm.id, title: 'spoof', body: 'smoke' } });
    if (fnStatus(error) === 404) throw new Skip('send-push not deployed');
    expect(fnStatus(error) === 403, `expected 403, got ${fnStatus(error) ?? 'success'} — redeploy send-push`);
  });

  // ===== 5. Targets + scorecards ==============================================

  await check('Data Analyst can set a target; a duplicate NC/month is rejected', async () => {
    const id1 = `${RUN}_tg1`;
    const id2 = `${RUN}_tg2`;
    expectOk(await analyst.client.from('targets').insert({ id: id1, nc_id: nc.id, period_key: TEST_PERIOD, offtake_target: 100, set_by: analyst.id }), 'target insert');
    created.targets.push(id1);
    const dup = await analyst.client.from('targets').insert({ id: id2, nc_id: nc.id, period_key: TEST_PERIOD, offtake_target: 50, set_by: analyst.id });
    if (!dup.error) created.targets.push(id2);
    expect(dup.error?.code === '23505', `duplicate target accepted (${dup.error?.code ?? 'no error'}) — 0009 not applied`);
  });

  await check('NC cannot set targets', async () => {
    const id = `${RUN}_tg_nc`;
    const res = await nc.client.from('targets').insert({ id, nc_id: nc.id, period_key: TEST_PERIOD, offtake_target: 1, set_by: nc.id });
    if (!res.error) created.targets.push(id);
    expect(res.error, 'NC wrote a target');
  });

  await check('Trainer can record a certification result; NC cannot', async () => {
    const id = `${RUN}_cert`;
    const ok = await trainer.client
      .from('certifications')
      .insert({ id, user_id: nc.id, cert_type: 'nc_onboarding', date: new Date(2000, 0, 15).toISOString(), passed: true });
    expectOk(ok, 'trainer certification insert');
    created.certifications.push(id);
    const idNc = `${RUN}_cert_nc`;
    const bad = await nc.client
      .from('certifications')
      .insert({ id: idNc, user_id: nc.id, cert_type: 'nc_onboarding', date: new Date(2000, 0, 15).toISOString(), passed: true });
    if (!bad.error) created.certifications.push(idNc);
    expect(bad.error, 'NC recorded their own certification');
    const { data } = await nc.client.from('certifications').select('id').eq('id', id);
    expect(data?.length === 1, 'NC cannot see their own certification result');
  });

  // ===== 6. Master-data editing (store pin, teams, products, own password) =====

  await check('TL can set the GPS pin of their team’s store; NC cannot edit stores', async () => {
    const { data: before } = await admin.from('stores').select('lat, lng').eq('id', 'st_demo1').single();
    try {
      const upd = await tl.client.from('stores').update({ lat: -6.2, lng: 106.8 }).eq('id', 'st_demo1').select('id');
      expect(!upd.error && upd.data?.length === 1, `TL could not update own-team store pin: ${upd.error?.message ?? '0 rows'}`);
      expectDenied(await nc.client.from('stores').update({ lat: 0, lng: 0 }).eq('id', 'st_demo1').select('id'), 'NC store edit');
    } finally {
      await admin.from('stores').update({ lat: before?.lat ?? null, lng: before?.lng ?? null }).eq('id', 'st_demo1');
    }
  });

  await check('Super Admin can edit a team and move a TL’s profile; TL cannot edit teams', async () => {
    const { data: t } = await admin.from('teams').select('name').eq('id', 't_jaksel').single();
    const upd = await superadmin.client.from('teams').update({ name: t!.name }).eq('id', 't_jaksel').select('id');
    expect(!upd.error && upd.data?.length === 1, `super_admin team update failed: ${upd.error?.message ?? '0 rows'}`);
    const prof = await superadmin.client.from('profiles').update({ team_id: 't_jaksel' }).eq('id', tl.id).select('id');
    expect(!prof.error && prof.data?.length === 1, `super_admin could not set TL team: ${prof.error?.message ?? '0 rows'}`);
    expectDenied(await tl.client.from('teams').update({ name: 'hijacked' }).eq('id', 't_jaksel').select('id'), 'TL team edit');
  });

  await check('Data Analyst can add, edit and deactivate a product; NC cannot', async () => {
    const id = `${RUN}_prod`;
    try {
      expectOk(await analyst.client.from('products').insert({ id, sku: `${RUN}-SKU`, name: 'Smoke', active: true }), 'product insert');
      const upd = await analyst.client.from('products').update({ name: 'Smoke 2', active: false }).eq('id', id).select('id');
      expect(!upd.error && upd.data?.length === 1, `product update failed: ${upd.error?.message ?? '0 rows'}`);
      expectDenied(await nc.client.from('products').update({ active: true }).eq('id', id).select('id'), 'NC product edit');
    } finally {
      await admin.from('products').delete().eq('id', id);
    }
  });

  await check('a user can change their own password (new password works, old one no longer does)', async () => {
    if (!nc2) throw new Skip('second NC unavailable');
    const newPw = 'Smoke-changed-456';
    expectOk(await nc2.client.auth.updateUser({ password: newPw }), 'updateUser(password)');
    const fresh = createClient(url!, anonKey!, noSession);
    const withNew = await fresh.auth.signInWithPassword({ email: `${nc2Username}@internal.spc`, password: newPw });
    expect(!withNew.error, `sign-in with new password failed: ${withNew.error?.message}`);
    const withOld = await fresh.auth.signInWithPassword({ email: `${nc2Username}@internal.spc`, password: nc2Password });
    expect(withOld.error, 'old password still works after change');
  });

  await check('compute_scorecards cannot be run anonymously or via the internal core', async () => {
    const anon = createClient(url!, anonKey!, noSession);
    expect((await anon.rpc('compute_scorecards', { p_period_key: TEST_PERIOD })).error, 'anon key alone ran compute_scorecards');
    expect(
      (await analyst.client.rpc('compute_scorecards_core', { p_period_key: TEST_PERIOD })).error,
      'compute_scorecards_core is callable from the API (should be internal-only)',
    );
    expect(
      (await analyst.client.rpc('run_scheduled_scorecards')).error,
      'run_scheduled_scorecards is callable from the API (should be cron-only)',
    );
    expect((await analyst.client.rpc('compute_scorecards', { p_period_key: '2000-13' })).error, 'invalid period accepted');
  });

  await check('compute_scorecards: forbidden for NC, allowed for Data Analyst', async () => {
    const denied = await nc.client.rpc('compute_scorecards', { p_period_key: TEST_PERIOD });
    expect(denied.error, 'NC ran compute_scorecards');
    expectOk(await analyst.client.rpc('compute_scorecards', { p_period_key: TEST_PERIOD }), 'analyst compute_scorecards');
    const { data } = await admin.from('scorecards').select('breakdown').eq('subject_id', nc.id).eq('period_key', TEST_PERIOD).single();
    expect(data, 'no scorecard written for demo NC');
  });
}

main()
  .catch((e) => results.push({ name: 'setup', outcome: 'FAIL', detail: e instanceof Error ? e.message : String(e) }))
  .finally(async () => {
    console.log('Cleaning up test rows...');
    await cleanup();
    console.log('');
    for (const r of results) console.log(`${r.outcome.padEnd(4)}  ${r.name}${r.detail ? `\n        ${r.detail}` : ''}`);
    const fails = results.filter((r) => r.outcome === 'FAIL').length;
    const skips = results.filter((r) => r.outcome === 'SKIP').length;
    console.log(`\n${results.length - fails - skips} passed, ${fails} failed, ${skips} skipped`);
    process.exit(fails ? 1 : 0);
  });
