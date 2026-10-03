-- A consumer's current funnel stage, kept on the consumer row. Run after
-- 0018_client_errors_dashboard_summary.sql.
--
-- Until now the app loaded EVERY ntg_gwp row (and every consumer) for every
-- role at login, because a consumer's current stage was "its highest step,
-- however old" — a gap in the history would have let an NC record an earlier
-- stage again. That grows without bound (program-wide for PM/admin roles).
--
-- consumers.current_stage / current_stage_at now hold that highest stage,
-- maintained by a trigger on every ntg_gwp insert and backfilled below; the
-- app reads the stage from the consumer row and loads ntg_gwp only for the
-- recent window it actually shows. Clients cannot set these columns: they are
-- ignored on insert and on any update that doesn't come from the trigger.

alter table public.consumers add column if not exists current_stage text;
alter table public.consumers add column if not exists current_stage_at timestamptz;

-- Backfill: highest-ranked stage per consumer (latest row on a tie).
update public.consumers c
   set current_stage = s.stage, current_stage_at = s.created_at
  from (
    select distinct on (consumer_id) consumer_id, stage, created_at
      from public.ntg_gwp
     order by consumer_id, public.ntg_stage_rank(stage) desc, created_at desc
  ) s
 where s.consumer_id = c.id;

-- ntg_gwp insert -> raise the consumer's current stage.
create or replace function public.ntg_gwp_sync_consumer_stage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Lets consumers_server_checks tell this write apart from a client's.
  perform set_config('app.consumer_stage_sync', 'on', true);
  update public.consumers
     set current_stage = new.stage, current_stage_at = new.created_at
   where id = new.consumer_id
     and (current_stage is null or public.ntg_stage_rank(new.stage) > public.ntg_stage_rank(current_stage));
  perform set_config('app.consumer_stage_sync', 'off', true);
  return null;
end;
$$;

drop trigger if exists ntg_gwp_sync_consumer_stage_trg on public.ntg_gwp;
create trigger ntg_gwp_sync_consumer_stage_trg
  after insert on public.ntg_gwp
  for each row execute function public.ntg_gwp_sync_consumer_stage();

-- consumers_server_checks (0015) + the stage columns are server-owned.
create or replace function public.consumers_server_checks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wa text := public.normalize_wa(new.wa_contact);
begin
  -- current_stage is derived from ntg_gwp only (trigger above).
  if tg_op = 'INSERT' then
    new.current_stage := null;
    new.current_stage_at := null;
  elsif coalesce(current_setting('app.consumer_stage_sync', true), 'off') <> 'on' then
    new.current_stage := old.current_stage;
    new.current_stage_at := old.current_stage_at;
  end if;

  -- WhatsApp number: validated and unique whenever it is set or changed.
  if new.erased_at is null and (tg_op = 'INSERT' or new.wa_contact is distinct from old.wa_contact) then
    if wa !~ '^628[0-9]{7,12}$' then
      raise exception 'Nomor WhatsApp tidak valid — gunakan nomor HP Indonesia, mis. 0812xxxxxxxx.';
    end if;
    if exists (select 1 from public.consumers c
                where c.wa_normalized = wa and c.id <> new.id and c.erased_at is null) then
      raise exception 'Nomor WhatsApp ini sudah terdaftar sebagai konsumen (oleh Anda atau NC lain).';
    end if;
  end if;

  -- Consent: required to create; its record is server-stamped and immutable.
  if tg_op = 'INSERT' and not new.consent then
    raise exception 'Consent konsumen wajib sebelum data disimpan (UU PDP).';
  end if;
  if tg_op = 'UPDATE' and old.consent and new.consent then
    new.consent_at := old.consent_at;
    new.consent_by := old.consent_by;
    new.consent_version := old.consent_version;
  elsif new.consent and (tg_op = 'INSERT' or not old.consent) then
    new.consent_at := now();
    new.consent_by := auth.uid();
    new.consent_version := coalesce(nullif(new.consent_version, ''), 'unversioned');
  end if;
  return new;
end;
$$;
