-- App Libreria: tabelle nuove con prefisso libreria_, separate da quelle dell'Hub.
-- Nessuna tabella, funzione o regola esistente viene toccata.

create table public.libreria_libraries (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Libreria',
  settings jsonb not null default '{}'::jsonb,   -- generi, liste desideri, persone, mobili
  settings_at bigint not null default 0,         -- quando sono cambiate (millisecondi, dal telefono)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Chi può entrare: email in minuscolo e nome con cui compare nell'app.
create table public.libreria_allowed (
  email text primary key check (email = lower(email)),
  library_id uuid not null references public.libreria_libraries(id) on delete cascade,
  name text not null default ''
);

create table public.libreria_members (
  library_id uuid not null references public.libreria_libraries(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '',
  joined_at timestamptz not null default now(),
  primary key (library_id, user_id)
);
create index libreria_members_user_idx on public.libreria_members(user_id);

-- Un libro = una riga; il contenuto è la scheda così com'è nell'app.
create table public.libreria_books (
  library_id uuid not null references public.libreria_libraries(id) on delete cascade,
  id text not null,
  data jsonb not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (library_id, id)
);
create index libreria_books_sync_idx on public.libreria_books(library_id, updated_at);

create or replace function public.libreria_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger libreria_books_touch before insert or update on public.libreria_books
  for each row execute function public.libreria_touch();

create or replace function public.libreria_touch_library() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger libreria_libraries_touch before update on public.libreria_libraries
  for each row execute function public.libreria_touch_library();

create or replace function public.libreria_is_member(lib uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.libreria_members m where m.library_id = lib and m.user_id = auth.uid());
$$;

-- All'accesso: se l'email è tra quelle ammesse, la persona entra nella sua libreria.
create or replace function public.libreria_join() returns table(library_id uuid, name text)
language plpgsql security definer set search_path = '' as $$
declare
  em text := lower(coalesce(auth.jwt() ->> 'email', ''));
  a record;
begin
  if auth.uid() is null then raise exception 'non autenticato'; end if;
  select al.library_id as lib, al.name as nm into a from public.libreria_allowed al where al.email = em;
  if not found then
    return query select m.library_id, m.name from public.libreria_members m where m.user_id = auth.uid() limit 1;
    return;
  end if;
  insert into public.libreria_members(library_id, user_id, name) values (a.lib, auth.uid(), a.nm)
    on conflict on constraint libreria_members_pkey do update set name = excluded.name;
  return query select a.lib, a.nm;
end $$;

revoke all on function public.libreria_join() from public, anon;
grant execute on function public.libreria_join() to authenticated;
revoke all on function public.libreria_is_member(uuid) from public, anon;
grant execute on function public.libreria_is_member(uuid) to authenticated;

alter table public.libreria_libraries enable row level security;
alter table public.libreria_allowed enable row level security;
alter table public.libreria_members enable row level security;
alter table public.libreria_books enable row level security;

create policy libreria_libraries_read on public.libreria_libraries for select to authenticated using (public.libreria_is_member(id));
create policy libreria_libraries_write on public.libreria_libraries for update to authenticated using (public.libreria_is_member(id)) with check (public.libreria_is_member(id));
create policy libreria_members_read on public.libreria_members for select to authenticated using (public.libreria_is_member(library_id));
create policy libreria_allowed_read on public.libreria_allowed for select to authenticated using (public.libreria_is_member(library_id));
create policy libreria_books_read on public.libreria_books for select to authenticated using (public.libreria_is_member(library_id));
create policy libreria_books_insert on public.libreria_books for insert to authenticated with check (public.libreria_is_member(library_id));
create policy libreria_books_update on public.libreria_books for update to authenticated using (public.libreria_is_member(library_id)) with check (public.libreria_is_member(library_id));

revoke all on public.libreria_libraries, public.libreria_allowed, public.libreria_members, public.libreria_books from anon;
grant select, update on public.libreria_libraries to authenticated;
grant select on public.libreria_allowed, public.libreria_members to authenticated;
grant select, insert, update on public.libreria_books to authenticated;

insert into public.libreria_libraries(name) values ('Libreria di casa');

-- Le due email ammesse si aggiungono a parte, con:
-- insert into public.libreria_allowed(email, library_id, name)
--   select 'email@esempio.it', id, 'Maurizio' from public.libreria_libraries where name = 'Libreria di casa';
