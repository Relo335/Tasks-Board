-- Optional weekly-reporting columns for marketing_entries.
-- Safe to run once; existing rows get NULL for these (the app derives them).
-- The app also degrades gracefully if you skip this, but running it lets the
-- app PERSIST manual overrides for Previous Week Followers, WoW Growth %,
-- and explicit Week Start / Week End dates.

alter table public.marketing_entries
  add column if not exists week_start     date,
  add column if not exists week_end       date,
  add column if not exists prev_followers numeric,
  add column if not exists wow_growth     numeric;
