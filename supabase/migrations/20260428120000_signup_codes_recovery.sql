alter table public.signup_codes
add column if not exists used_email text,
add column if not exists confirmed_at timestamptz;

create index if not exists signup_codes_used_email_lower_idx
on public.signup_codes ((lower(used_email)))
where used_email is not null;

update public.signup_codes sc
set
  used_email = coalesce(sc.used_email, u.email),
  confirmed_at = coalesce(sc.confirmed_at, u.email_confirmed_at)
from auth.users u
where sc.used_by = u.id
  and (sc.used_email is null or sc.confirmed_at is null);
