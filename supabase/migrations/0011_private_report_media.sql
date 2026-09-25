-- Private report-evidence photos. Run after 0010_scheduled_scorecards.sql.
--
-- 0002 created the `report-media` bucket as PUBLIC, so every evidence photo
-- (store shelves, displays, and potentially people in them) was readable by
-- anyone holding its URL, with no login — the report_media_select RLS policy
-- (own visit / TL-ARCO scope / monitor roles) was bypassed entirely because
-- public buckets serve objects without consulting it.
--
-- After this migration:
--   * the bucket is private; the app opens photos through short-lived signed
--     URLs (openReportPhoto, src/utils/storage.ts), which Storage only issues
--     when report_media_select allows the viewer to see that visit;
--   * report rows store the object path ("<visitId>/<file>") instead of a
--     public URL — existing rows are rewritten below. App builds from before
--     this change keep writing legacy public URLs; the app parses both forms
--     (src/utils/photoRef.ts), so nothing breaks while old APKs are in use —
--     their photos are simply viewed via signed URLs like everyone else's.
--
-- Note: builds from before this change open photos by linking directly to the
-- public URL, which stops working here. Reviewers need the updated app
-- (web: redeploy; Android: the next APK) to view evidence photos.

update storage.buckets set public = false where id = 'report-media';

-- Legacy public URL -> bucket object path, in all four report tables.
update public.stock_taking
   set photo_url = regexp_replace(photo_url, '^.*/object/public/report-media/', '')
 where photo_url like '%/object/public/report-media/%';
update public.share_of_shelf
   set photo_url = regexp_replace(photo_url, '^.*/object/public/report-media/', '')
 where photo_url like '%/object/public/report-media/%';
update public.paid_visibility
   set photo_url = regexp_replace(photo_url, '^.*/object/public/report-media/', '')
 where photo_url like '%/object/public/report-media/%';
update public.price_monitoring
   set photo_url = regexp_replace(photo_url, '^.*/object/public/report-media/', '')
 where photo_url like '%/object/public/report-media/%';
