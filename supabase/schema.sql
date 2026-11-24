-- Lumenport cloud saves. Run once in the Supabase dashboard: SQL Editor > New query > Run.
-- Every row belongs to one signed-in player, and row-level security lets each player read
-- and write only their own rows, whatever the browser sends.

create table if not exists public.city_saves (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  slot       text        not null check (slot in ('cloud-auto', 'cloud-1', 'cloud-2')),
  city_name  text        not null check (char_length(city_name) <= 80),
  population integer     not null default 0,
  funds      bigint      not null default 0,
  tick       bigint      not null default 0,
  -- The city: gzipped JSON in base64 (about 350 KB for a grown town). Capped at 3 MB.
  data       text        not null check (char_length(data) <= 3000000),
  updated_at timestamptz not null default now(),
  primary key (user_id, slot)
);

alter table public.city_saves enable row level security;

drop policy if exists "read own saves" on public.city_saves;
drop policy if exists "add own saves" on public.city_saves;
drop policy if exists "change own saves" on public.city_saves;
drop policy if exists "delete own saves" on public.city_saves;

create policy "read own saves"   on public.city_saves for select using ((select auth.uid()) = user_id);
create policy "add own saves"    on public.city_saves for insert with check ((select auth.uid()) = user_id);
create policy "change own saves" on public.city_saves for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own saves" on public.city_saves for delete using ((select auth.uid()) = user_id);

-- Newer Supabase projects grant nothing on new tables by default. Signed-in players get
-- row access (RLS above still limits them to their own rows); the anon key gets none.
grant select, insert, update, delete on public.city_saves to authenticated;
revoke truncate, references, trigger on public.city_saves from anon, authenticated;
