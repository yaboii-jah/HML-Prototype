-- Private, data-free invalidations. Existing writes remain the business authority.
create function private.foundation_topic(target_user uuid, revision bigint, target_session uuid) returns text
language sql immutable set search_path='' as $$
  select 'foundation:'||target_user::text||':'||revision::text||':'||target_session::text;
$$;
create function private.foundation_topic_allowed() returns boolean
language sql stable security definer set search_path='' as $$
  select private.current_user_authorized() and exists(
    select 1 from private.session_bindings b
    where b.user_id=(select auth.uid()) and b.session_id::text=(select auth.jwt()->>'session_id')
      and (select realtime.topic())=private.foundation_topic(b.user_id,b.access_revision,b.session_id));
$$;
revoke all on function private.foundation_topic(uuid,bigint,uuid),private.foundation_topic_allowed() from public,anon,authenticated,service_role;
grant execute on function private.foundation_topic_allowed() to authenticated;
create policy foundation_receive on realtime.messages for select to authenticated
  using(extension='broadcast' and (select private.foundation_topic_allowed()));
-- No INSERT policy: neither Broadcast publishing nor Presence is permitted.

create function private.foundation_write(kind text, args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  result jsonb; before_value jsonb; after_value jsonb; old_bindings jsonb;
  operation uuid:=(args->>'operation')::uuid;
  target uuid:=(args->>'target')::uuid;
  affected_project uuid; changed boolean:=false; recipient record; prior jsonb;
begin
  perform set_config('lock_timeout','5s',true);
  -- A real write also rejects stale REPEATABLE READ snapshots.
  update private.account_guard set revision=revision+1 where id;
  select coalesce(jsonb_agg(to_jsonb(b)),'[]'::jsonb) into old_bindings
    from private.session_bindings b join public.profiles p on p.user_id=b.user_id
    join auth.sessions s on s.id=b.session_id and s.user_id=b.user_id
    where p.is_active and p.access_revision=b.access_revision and (s.not_after is null or s.not_after>now());
  if kind='project' then
    operation:=(args->'command'->>'requestId')::uuid;
    select to_jsonb(o) into before_value from private.project_operations o where o.id=operation;
    result:=private.project_command(args->'actor',args->'command');
    affected_project:=(result->>'projectId')::uuid;
    changed:=before_value is null and coalesce((result->>'changed')::boolean,false);
  elsif kind in('reserve','complete','save','message') then
    if kind='save' then
      before_value:=private.account_view(target);
    else
      select to_jsonb(o) into before_value from private.account_operations o where o.id=operation;
    end if;
    case kind
      when 'reserve' then result:=private.account_reserve(args->'actor',operation,args->'draft');
      when 'complete' then result:=private.account_complete(args->'actor',operation);
      when 'save' then result:=private.account_save(args->'actor',operation,target,args->>'expected_version',args->'draft');
      when 'message' then result:=private.account_message(args->'actor',operation,target,args->>'expected_version',args->>'message_kind',args->>'outcome');
    end case;
    if kind='save' then
      after_value:=private.account_view(target);
    else
      select to_jsonb(o),o.target_id into after_value,target from private.account_operations o where o.id=operation;
    end if;
    changed:=before_value is distinct from after_value;
  elsif kind='bind' then
    target:=(args->>'target_user')::uuid;
    select to_jsonb(p.first_signed_in_at) into before_value from public.profiles p where p.user_id=target;
    result:=to_jsonb(private.bind_session(target,(args->>'target_session')::uuid,args->>'expected_revision',args->>'expected_credential'));
    select to_jsonb(p.first_signed_in_at) into after_value from public.profiles p where p.user_id=target;
    changed:=before_value is distinct from after_value;
  elsif kind='unbind' then
    perform private.unbind_session((args->>'target_user')::uuid,(args->>'target_session')::uuid);
    result:='null'::jsonb;
  else
    raise exception 'Unsupported foundation write' using errcode='23514';
  end if;
  -- Enqueue last. Native Auth reset/logout never acquires the foundation guard.
  -- SHARE orders publication before native session DELETE, or rechecks after it.
  -- No further Auth/profile/project locks may be acquired after this point.
  perform s.id from auth.sessions s join private.session_bindings b on b.session_id=s.id
    order by s.id for share of s;
  for prior in select value from jsonb_array_elements(old_bindings) loop
    if not exists(select 1 from private.session_bindings b join public.profiles p on p.user_id=b.user_id
      where b.session_id=(prior->>'session_id')::uuid and b.access_revision=(prior->>'access_revision')::bigint
        and p.is_active and p.access_revision=b.access_revision) then
      perform realtime.send('{}'::jsonb,'access_changed',
        private.foundation_topic((prior->>'user_id')::uuid,(prior->>'access_revision')::bigint,(prior->>'session_id')::uuid),true);
    end if;
  end loop;
  if changed then
    for recipient in
      select b.* from private.session_bindings b
      join auth.sessions s on s.id=b.session_id and s.user_id=b.user_id
      join public.profiles p on p.user_id=b.user_id
      join auth.users u on u.id=p.user_id
      where p.is_active and p.access_revision=b.access_revision
        and (s.not_after is null or s.not_after>now())
        and not u.is_anonymous and u.email_confirmed_at is not null
        and (u.banned_until is null or u.banned_until<=now())
        and (
          (kind='project' and (
            exists(select 1 from public.role_grants g where g.user_id=p.user_id and g.role<>'Site Personnel')
            or exists(select 1 from public.project_assignments a where a.user_id=p.user_id and a.project_id=affected_project)))
          or (kind<>'project' and (
            p.user_id=target
            or exists(select 1 from public.role_grants g where g.user_id=p.user_id and g.role='Administrator')
            or (kind='save' and before_value->'projectIds' is distinct from after_value->'projectIds'
              and exists(select 1 from public.role_grants g where g.user_id=p.user_id and g.role='Project Manager'))))
        )
    loop
      perform realtime.send('{}'::jsonb,'foundation_changed',
        private.foundation_topic(recipient.user_id,recipient.access_revision,recipient.session_id),true);
    end loop;
  end if;
  return result;
end;
$$;
revoke all on function private.foundation_write(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.foundation_write(text,jsonb) to service_role;

create or replace function public.project_command(actor jsonb,command jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.foundation_write('project',jsonb_build_object('actor',actor,'command',command)); $$;
revoke execute on function private.project_command(jsonb,jsonb) from service_role;

create or replace function public.account_reserve(actor jsonb,operation uuid,draft jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.foundation_write('reserve',jsonb_build_object('actor',actor,'operation',operation,'draft',draft)); $$;
revoke execute on function private.account_reserve(jsonb,uuid,jsonb) from service_role;

create or replace function public.account_complete(actor jsonb,operation uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.foundation_write('complete',jsonb_build_object('actor',actor,'operation',operation)); $$;
revoke execute on function private.account_complete(jsonb,uuid) from service_role;

create or replace function public.account_save(actor jsonb,operation uuid,target uuid,expected_version text,draft jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.foundation_write('save',jsonb_build_object('actor',actor,'operation',operation,'target',target,'expected_version',expected_version,'draft',draft)); $$;
revoke execute on function private.account_save(jsonb,uuid,uuid,text,jsonb) from service_role;

create or replace function public.account_message(actor jsonb,operation uuid,target uuid,expected_version text,message_kind text,outcome text default null) returns jsonb
language sql security invoker set search_path='' as $$ select private.foundation_write('message',jsonb_build_object('actor',actor,'operation',operation,'target',target,'expected_version',expected_version,'message_kind',message_kind,'outcome',outcome)); $$;
revoke execute on function private.account_message(jsonb,uuid,uuid,text,text,text) from service_role;

create or replace function public.auth_bind_session(target_user uuid,target_session uuid,expected_revision text,expected_credential text) returns boolean
language sql security invoker set search_path='' as $$ select (private.foundation_write('bind',jsonb_build_object('target_user',target_user,'target_session',target_session,'expected_revision',expected_revision,'expected_credential',expected_credential)))::text::boolean; $$;
revoke execute on function private.bind_session(uuid,uuid,text,text) from service_role;

create or replace function public.auth_unbind_session(target_user uuid,target_session uuid) returns void
language sql security invoker set search_path='' as $$ select private.foundation_write('unbind',jsonb_build_object('target_user',target_user,'target_session',target_session)); $$;
revoke execute on function private.unbind_session(uuid,uuid) from service_role;
