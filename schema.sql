-- 潮信 · 网页阅读版 Supabase 建表脚本
-- 在 Supabase 后台 SQL Editor 里整段运行。可以重复运行，不会删任何已有数据。
-- 三部曲可以共用这一个 Supabase 项目：每条数据前面带着书的 key（潮信 cx、浊堤 zd、围涂 wt），
-- 互不干扰；读者在三本书里用同一个邮箱、同一个昵称。

-- 1. 读者昵称（不能重名，不分大小写）
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(btrim(nickname)) between 1 and 20),
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_nickname_key on public.profiles (lower(btrim(nickname)));

-- 2. 作者（管理员）名单
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- 3. 阅读器的全部共享数据：一行一个文档
--    cx:u/<读者id>   这位读者在《潮信》里公开的评论、点赞、公开划线、读后感
--    cx:s/<读者id>   阅读统计（只有作者和本人能看）
--    cx:edit/recaps  作者改过的前情提要
create table if not exists public.docs (
  path text primary key,
  coll text not null,
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  constraint docs_size check (pg_column_size(data) < 262144)
);
create index if not exists docs_coll_idx on public.docs (coll);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;
grant execute on function public.is_admin() to anon, authenticated;

alter table public.profiles enable row level security;
alter table public.admins enable row level security;
alter table public.docs enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (true);
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert with check (id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists admins_read on public.admins;
create policy admins_read on public.admins for select using (user_id = auth.uid());

drop policy if exists docs_read on public.docs;
create policy docs_read on public.docs for select
  using (split_part(coll, ':', 2) in ('u', 'edit') or owner = auth.uid() or public.is_admin());

drop policy if exists docs_insert on public.docs;
create policy docs_insert on public.docs for insert with check (
  owner = auth.uid()
  and exists (select 1 from public.profiles where id = auth.uid())
  and (
    (split_part(coll, ':', 2) in ('u', 's') and path = coll || '/' || auth.uid()::text)
    or (split_part(coll, ':', 2) = 'edit' and public.is_admin())
  )
);

drop policy if exists docs_update on public.docs;
create policy docs_update on public.docs for update
  using (owner = auth.uid() or public.is_admin())
  with check (owner = auth.uid() or public.is_admin());

drop policy if exists docs_delete on public.docs;
create policy docs_delete on public.docs for delete
  using (owner = auth.uid() or public.is_admin());

-- 4. 实时推送（评论发出去别人马上看到）。已经加过会报 duplicate，忽略即可。
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when others then null;
end $$;

-- 5. 把自己设成作者：先在网页上用邮箱登录一次、起好昵称，再把下面的邮箱换成你的，单独运行这一句。
-- insert into public.admins (user_id) select id from auth.users where email = '你的邮箱' on conflict do nothing;
