begin;
do $$
declare signature text;
begin
  if not (select relrowsecurity from pg_class where oid='realtime.messages'::regclass) then raise exception 'Realtime RLS disabled'; end if;
  if not exists(select 1 from pg_policies where schemaname='realtime' and tablename='messages' and policyname='foundation_receive' and cmd='SELECT') then raise exception 'Missing private receiver policy'; end if;
  if exists(select 1 from pg_policies where schemaname='realtime' and tablename='messages' and cmd in('ALL','INSERT')) then raise exception 'Browser publishing policy present'; end if;
  foreach signature in array array[
    'private.foundation_write(text,jsonb)',
    'private.project_command(jsonb,jsonb)',
    'private.account_save(jsonb,uuid,uuid,text,jsonb)',
    'private.bind_session(uuid,uuid,text,text)',
    'private.unbind_session(uuid,uuid)'
  ] loop
    if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute') then raise exception 'Privileged writer exposed'; end if;
    if signature<>'private.foundation_write(text,jsonb)' and has_function_privilege('service_role',signature,'execute') then raise exception 'Writer bypasses guard adapter'; end if;
  end loop;
  if not has_function_privilege('service_role','private.foundation_write(text,jsonb)','execute') then raise exception 'Guarded service adapter unavailable'; end if;
end $$;
rollback;
