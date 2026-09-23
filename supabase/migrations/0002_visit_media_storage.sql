-- Phase: sync report-evidence photos/docs (Stock Taking, Share of Shelf,
-- Paid Visibility, Price Monitoring — PRD §5) to Supabase Storage (public bucket).
-- Run this once in the Supabase SQL editor, after 0001_init.sql.

insert into storage.buckets (id, name, public)
values ('report-media', 'report-media', true)
on conflict (id) do nothing;

-- storage.objects already has RLS enabled by default on Supabase-managed
-- projects (and is owned by a system role, so ALTER TABLE ... ENABLE ROW
-- LEVEL SECURITY on it fails with "must be owner of table objects" if you
-- try to run it yourself) — only the policies below are ours to add.

-- Path convention: {visit_id}/{random}.{ext} — first path segment is used to
-- join back to visits for RLS, mirroring visits_write_own/visit_is_own_or_scoped
-- from 0001_init.sql. The bucket is public, so normal reads go through Storage's
-- public URL endpoint (bypassing this SELECT policy) — it's defense-in-depth
-- for direct table/API access, e.g. if the bucket is ever flipped private.

create policy report_media_insert on storage.objects for insert
with check (
  bucket_id = 'report-media'
  and exists (
    select 1 from public.visits v
    where v.id = (storage.foldername(name))[1] and v.nc_id = auth.uid()
  )
);

create policy report_media_select on storage.objects for select
using (
  bucket_id = 'report-media'
  and exists (
    select 1 from public.visits v
    where v.id = (storage.foldername(name))[1]
    and (
      public.is_monitor_role()
      or (public.current_role() = 'tl'
          and v.nc_id in (select id from public.profiles where team_id = public.current_team_id()))
      or (public.current_role() = 'arco'
          and v.nc_id in (select id from public.profiles where team_id in (select public.current_arco_team_ids())))
      or v.nc_id = auth.uid()
    )
  )
);

create policy report_media_delete on storage.objects for delete
using (
  bucket_id = 'report-media'
  and exists (
    select 1 from public.visits v
    where v.id = (storage.foldername(name))[1] and v.nc_id = auth.uid()
  )
);
