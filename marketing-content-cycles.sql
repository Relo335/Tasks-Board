-- Repeat the 4-week content plan forward, continuously.
--
-- The plan is exactly 28 days long (Mon 2026-08-24 through Sun 2026-09-20), so
-- shifting it by whole multiples of 28 lands every post back on the same
-- weekday AND the same time slot. That is why the weekday written into each
-- note stays correct across cycles. After post 20 the cycle returns to post 1.
--
-- Cycle 1 is the seeded plan (marketing-content-seed.sql); this adds cycles
-- 2 through 13, carrying the calendar through Sun 2027-08-22 (one year).
-- To go further or shorter, change the 12 in generate_series below.
--
-- Run AFTER marketing-content-seed.sql, in Supabase -> SQL Editor.
-- Safe to re-run in any order and any number of times:
--   * new posts are inserted, existing ones are left completely untouched
--     (on conflict do nothing), so anything your team has edited, attached a
--     file to, or marked Posted is never overwritten;
--   * only the original 28-day window is used as the source, so cycles never
--     breed further cycles.

insert into public.marketing_content
  (id, date, brand, platform, title, content_type, owner, status, notes, publish_date, publish_time)
select
  'mc_' || to_char(b.publish_date + k * 28, 'YYYY-MM-DD') || substring(b.id from 14),
  b.date + k * 28,
  b.brand, b.platform, b.title, b.content_type, b.owner,
  'Scheduled',
  regexp_replace(b.notes, ' · Cycle [0-9]+$', '') || ' · Cycle ' || (k + 1),
  b.publish_date + k * 28,
  b.publish_time
from public.marketing_content b
cross join generate_series(1, 12) as k
where b.id like 'mc\_%'
  and b.publish_date between date '2026-08-24' and date '2026-09-20'
on conflict (id) do nothing;

-- Label the original 28 days as Cycle 1 so every post reads consistently.
update public.marketing_content
   set notes = notes || ' · Cycle 1'
 where id like 'mc\_%'
   and publish_date between date '2026-08-24' and date '2026-09-20'
   and notes not like '%· Cycle %';
