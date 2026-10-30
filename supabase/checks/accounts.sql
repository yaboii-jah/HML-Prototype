-- All identities, changes and immutable audits belong to this rolled-back transaction.
begin;
set local statement_timeout='30s';
do $$
declare
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); staff uuid;
  sa uuid:=gen_random_uuid(); sb uuid:=gen_random_uuid(); fresh uuid:=gen_random_uuid();
  project uuid:=gen_random_uuid(); operation uuid:=gen_random_uuid(); change_id uuid:=gen_random_uuid();
  actor jsonb; other_actor jsonb; preflight jsonb; draft jsonb; saved jsonb; original jsonb; result jsonb;
  audit_count bigint; signature text; retained_usable_admins bigint;
begin
  select count(*) into retained_usable_admins from public.profiles p join auth.users u on u.id=p.user_id
    join public.role_grants g on g.user_id=p.user_id and g.role='Administrator'
    where p.is_active and p.first_signed_in_at is not null and u.email_confirmed_at is not null
      and not u.is_anonymous and (u.banned_until is null or u.banned_until<=now());
  foreach signature in array array['public.accounts_directory(jsonb)','public.account_reserve(jsonb,uuid,jsonb)',
    'public.account_complete(jsonb,uuid)','public.account_save(jsonb,uuid,uuid,text,jsonb)',
    'public.account_message(jsonb,uuid,uuid,text,text,text)'] loop
    if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute')
      or not has_function_privilege('service_role',signature,'execute') then raise exception 'Invalid account RPC privileges'; end if;
  end loop;
  if to_regprocedure('public.auth_bind_session(uuid,uuid,text)') is not null then raise exception 'Old binding bypass retained'; end if;
  insert into auth.users(id,email,is_anonymous,email_confirmed_at,encrypted_password)
    values(a,a::text||'@example.invalid',false,now(),'before-reset'),(b,b::text||'@example.invalid',false,now(),'fixture');
  insert into public.profiles(user_id,display_name,is_active) values(a,'Account actor',true),(b,'Backup actor',true);
  insert into public.role_grants values(a,'Administrator'),(b,'Administrator');
  insert into auth.sessions(id,user_id,created_at,updated_at) values(sa,a,now(),now()),(sb,b,now(),now()),(fresh,a,now(),now());
  preflight:=private.login_preflight(a::text||'@example.invalid');
  if private.bind_session(a,sa,preflight->>'revision',null) then raise exception 'Missing credential accepted'; end if;
  if not private.bind_session(a,sa,preflight->>'revision',preflight->>'credential') then raise exception 'Actor binding failed'; end if;
  if (select first_signed_in_at is null from public.profiles where user_id=a) then raise exception 'First application sign-in not recorded'; end if;
  preflight:=private.login_preflight(b::text||'@example.invalid');
  if not private.bind_session(b,sb,preflight->>'revision',preflight->>'credential') then raise exception 'Backup binding failed'; end if;
  actor:=jsonb_build_object('userId',a,'sessionId',sa,'revision',(select access_revision::text from public.profiles where user_id=a),'activeRole','Administrator');
  other_actor:=jsonb_build_object('userId',b,'sessionId',sb,'revision',(select access_revision::text from public.profiles where user_id=b),'activeRole','Administrator');
  begin perform private.accounts_directory(actor||'{"activeRole":"Accounting"}'::jsonb); raise exception 'Wrong active role accepted'; exception when insufficient_privilege then null; end;
  begin perform private.accounts_directory(actor||jsonb_build_object('sessionId',gen_random_uuid())); raise exception 'Forged session accepted'; exception when insufficient_privilege then null; end;
  draft:=jsonb_build_object('name','Pending staff','email',gen_random_uuid()::text||'@example.invalid','roles',jsonb_build_array('Site Personnel'),'projectIds','[]'::jsonb,'active',true,'clearAssignments',false);
  result:=private.account_reserve(actor,operation,draft); staff:=(result->>'id')::uuid;
  if private.account_reserve(actor,operation,draft)<>result then raise exception 'Reservation retry changed identity'; end if;
  begin perform private.account_reserve(actor,gen_random_uuid(),draft); raise exception 'Duplicate email reserved'; exception when unique_violation then null; end;
  insert into auth.users(id,email,is_anonymous,encrypted_password,raw_app_meta_data)
    values(staff,draft->>'email',false,'unknown-random',jsonb_build_object('account_request_id',operation));
  saved:=private.account_complete(actor,operation);
  if (saved->>'confirmed')::boolean or saved->>'firstSignedInAt' is not null or saved->>'messageStatus'<>'not_sent' then raise exception 'Pending account reported onboarded'; end if;
  if private.account_complete(actor,operation)<>saved then raise exception 'Provisioning retry changed account'; end if;
  if (select count(*) from private.audit_events where request_id=operation)<>1 then raise exception 'Provisioning audit duplicated'; end if;
  draft:=(draft-'email'); original:=saved;
  select count(*) into audit_count from private.audit_events;
  saved:=private.account_save(actor,change_id,staff,saved->>'version',draft);
  if saved<>original or (select count(*) from private.audit_events)<>audit_count then raise exception 'No-op changed account/audit'; end if;
  if private.account_save(actor,change_id,staff,original->>'version',draft)<>saved then raise exception 'No-op retry changed result'; end if;
  begin perform private.account_save(actor,change_id,staff,saved->>'version',draft||'{"name":"different"}'::jsonb); raise exception 'Retry payload substitution accepted'; exception when check_violation then null; end;
  insert into public.projects(id,name) values(project,'Account fixture '||project::text);
  saved:=private.account_save(actor,gen_random_uuid(),staff,saved->>'version',draft||jsonb_build_object('projectIds',jsonb_build_array(project)));
  begin perform private.account_save(actor,gen_random_uuid(),staff,original->>'version',draft); raise exception 'Stale write accepted'; exception when serialization_failure then null; end;
  begin perform private.account_save(actor,gen_random_uuid(),staff,saved->>'version',draft||'{"roles":["Site Personnel","Accounting"]}'::jsonb); raise exception 'Mixed Site roles accepted'; exception when check_violation then null; end;
  begin perform private.account_save(actor,gen_random_uuid(),staff,saved->>'version',draft||jsonb_build_object('projectIds',jsonb_build_array(project,project))); raise exception 'Duplicate assignment accepted'; exception when check_violation then null; end;
  draft:=draft||'{"roles":["Accounting","Finance"],"projectIds":[]}'::jsonb;
  begin perform private.account_save(actor,gen_random_uuid(),staff,saved->>'version',draft); raise exception 'Unconfirmed assignment clearing accepted'; exception when check_violation then null; end;
  saved:=private.account_save(actor,gen_random_uuid(),staff,saved->>'version',draft||'{"clearAssignments":true}'::jsonb);
  if jsonb_array_length(saved->'projectIds')<>0 or jsonb_array_length(saved->'roles')<>2 then raise exception 'Conversion not atomic'; end if;
  original:=saved;
  saved:=private.account_save(actor,gen_random_uuid(),staff,saved->>'version',draft||'{"active":false}'::jsonb);
  begin perform private.account_message(actor,gen_random_uuid(),staff,saved->>'version','invite'); raise exception 'Inactive message accepted'; exception when check_violation then null; end;
  saved:=private.account_save(actor,gen_random_uuid(),staff,saved->>'version',draft);
  if saved->'roles'<>original->'roles' then raise exception 'Reactivation lost roles'; end if;
  change_id:=gen_random_uuid();
  result:=private.account_message(actor,change_id,staff,saved->>'version','invite');
  if result->>'dispatch'<>'true' then raise exception 'New message did not reserve dispatch'; end if;
  if private.account_message(actor,change_id,staff,saved->>'version','invite')->>'dispatch'<>'false' then raise exception 'Retry repeated dispatch'; end if;
  perform private.account_message(actor,change_id,staff,saved->>'version','invite','uncertain');
  if private.account_message(actor,change_id,staff,saved->>'version','invite','accepted')->>'state'<>'uncertain' then raise exception 'Completed outcome overwritten'; end if;
  update auth.users set email_confirmed_at=now() where id=staff;
  begin perform private.account_message(actor,gen_random_uuid(),staff,saved->>'version','invite'); raise exception 'Confirmed identity invited again'; exception when check_violation then null; end;
  perform private.account_message(actor,gen_random_uuid(),staff,saved->>'version','recovery');
  draft:=jsonb_build_object('name','Account actor','roles',jsonb_build_array('Administrator'),'projectIds','[]'::jsonb,'active',false,'clearAssignments',false);
  begin perform private.account_save(actor,gen_random_uuid(),a,private.account_view(a)->>'version',draft); raise exception 'Self-deactivation accepted'; exception when check_violation then null; end;
  begin perform private.account_save(actor,gen_random_uuid(),a,private.account_view(a)->>'version',draft||'{"active":true,"roles":["Accounting"]}'::jsonb); raise exception 'Self-demotion accepted'; exception when check_violation then null; end;
  -- A pending Administrator is not a qualified backup, even with confirmed Auth.
  update public.profiles set first_signed_in_at=null where user_id=b;
  if retained_usable_admins=0 then
    begin perform private.account_save(other_actor,gen_random_uuid(),a,private.account_view(a)->>'version',draft); raise exception 'Last usable Administrator removed'; exception when check_violation then null; end;
  else
    -- A populated staging workspace legitimately has another usable Admin.
    -- Do not change retained accounts to manufacture an empty-workspace case.
    -- The full global-count and competing-lock scenarios run in disposable CI.
    if (select count(*) from public.profiles p where p.user_id in(a,b) and p.is_active and p.first_signed_in_at is not null)<>1 then
      raise exception 'Pending fixture Administrator counted as onboarded';
    end if;
    raise notice 'Global last-Administrator removal is covered in disposable CI; retained staging Administrators are untouched';
  end if;
  update public.profiles set first_signed_in_at=now() where user_id=b;
  preflight:=private.login_preflight(a::text||'@example.invalid');
  update auth.users set encrypted_password='after-reset' where id=a;
  if private.bind_session(a,fresh,preflight->>'revision',preflight->>'credential') then raise exception 'In-flight old password login accepted after reset'; end if;
  delete from auth.sessions where id=sa;
  begin perform private.accounts_directory(actor); raise exception 'Deleted managed session retained access'; exception when insufficient_privilege then null; end;
end;
$$;
rollback;
