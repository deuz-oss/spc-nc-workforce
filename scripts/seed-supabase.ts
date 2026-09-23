/**
 * One-time (but safely re-runnable) seed of the Supabase project with a
 * handful of demo accounts (one per role) and 2-3 demo stores — Phase 1
 * only. This is NOT the real 47-city store master data (PRD §13); that
 * lands via the CSV bulk import flow in the Import screen once real data
 * is available. Run with:
 *
 *   npm run seed:supabase
 *
 * Requires .env (see .env.example) with EXPO_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY set. The service-role key bypasses RLS - never
 * ship it in the app, never commit it.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { buildSeed } from '../src/store/seed';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Copy .env.example to .env and fill them in.');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { teams, users, stores, surveys } = buildSeed();

  console.log(`Seeding ${teams.length} teams, ${users.length} users, ${stores.length} stores, ${surveys.length} surveys...`);

  // 1. Teams (tl_id/arco_id filled in after users exist — circular FK).
  const { error: teamsErr } = await supabase.from('teams').upsert(
    teams.map((t) => ({ id: t.id, name: t.name, city: t.city, tl_id: null, arco_id: null })),
  );
  if (teamsErr) throw teamsErr;
  console.log('teams done');

  // 2. Auth users (profiles rows are created automatically by the
  //    handle_new_auth_user trigger from 0001_init.sql). Map each seed
  //    user's local id (e.g. "u_nc") to the real auth uuid Supabase assigns,
  //    since every downstream table's FK needs the uuid, not the local id.
  const idMap = new Map<string, string>();
  const usernameToUuid = new Map<string, string>();
  for (const u of users) {
    const email = `${u.username.toLowerCase()}@internal.spc`;
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: u.password,
      email_confirm: true,
      user_metadata: { name: u.name, username: u.username, city: u.city, phone: u.phone },
    });
    let userId: string;
    if (error) {
      if (!error.message.toLowerCase().includes('already')) throw error;
      const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      if (listErr) throw listErr;
      const existing = list.users.find((x) => x.email === email);
      if (!existing) throw error;
      userId = existing.id;
      console.log(`  ${u.username} already exists, reusing ${existing.id}`);
    } else {
      userId = data.user.id;
      console.log(`  created ${u.username} -> ${data.user.id}`);
    }
    // handle_new_auth_user (0008 migration) creates profiles inactive and never
    // trusts user metadata for role/team — grant them here with the service role.
    const { error: activateErr } = await supabase
      .from('profiles')
      .update({ role: u.role, team_id: u.teamId, active: true })
      .eq('id', userId);
    if (activateErr) throw activateErr;
    idMap.set(u.id, userId);
    usernameToUuid.set(u.username, userId);
  }

  // 3. Wire team.tl_id / team.arco_id now that the real uuids exist.
  const tl = users.find((u) => u.role === 'tl');
  const arco = users.find((u) => u.role === 'arco');
  if (tl || arco) {
    const { error } = await supabase
      .from('teams')
      .update({ tl_id: tl ? idMap.get(tl.id) : null, arco_id: arco ? idMap.get(arco.id) : null })
      .eq('id', 't_jaksel');
    if (error) throw error;
    console.log('team leadership wired');
  }

  // 4. Stores (remap assigned NC from username -> real auth uuid)
  const { error: storesErr } = await supabase.from('stores').upsert(
    stores.map((s) => ({
      id: s.id,
      name: s.name,
      address: s.address,
      city: s.city,
      channel: s.channel,
      account: s.account,
      category: s.category,
      lat: s.lat,
      lng: s.lng,
      assigned_nc_id: s.assignedNcUsername ? usernameToUuid.get(s.assignedNcUsername) : null,
      team_id: s.teamId,
      source: s.source,
      created_at: new Date(s.createdAt).toISOString(),
    })),
  );
  if (storesErr) throw storesErr;
  console.log('stores done');

  // 5. Surveys (remap createdByUsername -> real auth uuid). `questions: []` —
  //    the Nutrition Quiz's content/branching lives in NutritionQuizScreen's
  //    code, not this row; see src/store/seed.ts's comment.
  const { error: surveysErr } = await supabase.from('surveys').upsert(
    surveys.map((s) => ({
      id: s.id,
      title: s.title,
      questions: [],
      campaign_tag: s.campaignTag,
      created_by: usernameToUuid.get(s.createdByUsername),
      created_at: new Date(s.createdAt).toISOString(),
    })),
  );
  if (surveysErr) throw surveysErr;
  console.log('surveys done');

  console.log('\nSeed complete. Demo logins (username / password):');
  for (const u of users) console.log(`  ${u.username} / ${u.password}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
