-- Rollback-only synthetic owners. These fixtures establish no real receipt,
-- opening-stock policy, warehouse custody or source-review authorization.
begin;
set local statement_timeout='90s';
create function pg_temp.stock_fixture() returns jsonb language plpgsql as $$
declare buyer uuid:=gen_random_uuid(); site uuid:=gen_random_uuid(); project uuid:=gen_random_uuid(); other_project uuid:=gen_random_uuid();
  person uuid; session uuid; proof jsonb; actors jsonb:='{}'; role_name text;
begin
  insert into public.projects(id,name) values(project,'Stock fixture '||project),(other_project,'Stock foreign '||other_project);
  foreach person in array array[buyer,site] loop
    role_name:=case when person=buyer then 'Procurement' else 'Site Personnel' end; session:=gen_random_uuid();
    insert into auth.users(id,email,is_anonymous,email_confirmed_at,encrypted_password) values(person,person||'@example.invalid',false,now(),'fixture');
    insert into public.profiles(user_id,display_name,is_active) values(person,'Stock fixture',true);
    insert into public.role_grants values(person,role_name);
    if person=site then insert into public.project_assignments values(person,project); end if;
    insert into auth.sessions(id,user_id,created_at,updated_at) values(session,person,now(),now());
    proof:=private.login_preflight(person||'@example.invalid');
    perform private.bind_session(person,session,proof->>'revision',proof->>'credential');
    actors:=actors||jsonb_build_object(role_name,jsonb_build_object('userId',person,'sessionId',session,'revision',proof->>'revision','activeRole',role_name));
  end loop;
  return jsonb_build_object('actor',actors->'Procurement','siteActor',actors->'Site Personnel','project',project,'otherProject',other_project);
end $$;
create function pg_temp.stock_account(account uuid,project uuid,label text default 'Cement',unit text default 'bag',version text default null)
returns jsonb language sql as $$
  select jsonb_build_object('accountId',account,'projectId',project,'description',label,'unit',unit,
    'expectedVersion',coalesce(version,(select a.version::text from private.stock_accounts a where a.id=account),'0'));
$$;
create function pg_temp.stock_posting(account uuid,amount text,kind text default 'receipt',source uuid default gen_random_uuid(),line uuid default gen_random_uuid(),reservation uuid default null)
returns jsonb language sql as $$
  select jsonb_build_object('accountId',account,'quantity',amount,'postingKind',kind,'sourceId',source,'sourceLineId',line,'reservationId',reservation,
    'sourceKind',case kind when 'receipt' then 'purchase_receipt' when 'dispatch' then 'transfer_trip' when 'usage' then 'usage_entry' else 'stock_adjustment' end);
$$;
create function pg_temp.stock_action(actor jsonb,accounts jsonb,postings jsonb default '[]',reservations jsonb default '[]',operation uuid default gen_random_uuid())
returns jsonb language sql as $$ select private.stock_apply(actor,operation,accounts,postings,reservations,'Synthetic owning transition'); $$;

-- Assertions (race runner reuses only these fixture definitions).
do $$
declare f jsonb:=pg_temp.stock_fixture(); actor jsonb:=f->'actor'; project uuid:=(f->>'project')::uuid;
  account uuid:=gen_random_uuid(); second uuid:=gen_random_uuid(); third uuid:=gen_random_uuid(); failed uuid:=gen_random_uuid();
  a jsonb; b jsonb; posting jsonb; hold jsonb; result jsonb; original jsonb; operation uuid:=gen_random_uuid();
  reservation uuid:=gen_random_uuid(); count_before bigint; stamp timestamptz; candidate jsonb;
begin
  a:=jsonb_build_array(pg_temp.stock_account(account,project)); posting:=pg_temp.stock_posting(account,'18');
  result:=pg_temp.stock_action(actor,a,jsonb_build_array(posting),'[]',operation);
  if result->'accounts'->0->>'onHand'<>'18' then raise exception 'Receipt not posted'; end if;
  select posted_at into stamp from private.stock_movements where operation_id=operation;
  if pg_temp.stock_action(actor,a,jsonb_build_array(posting),'[]',operation)<>result then raise exception 'Retry outcome changed'; end if;
  if pg_temp.stock_action(actor,a,jsonb_build_array(posting))<>result then raise exception 'Source replay outcome changed'; end if;
  if (select count(*) from private.stock_movements where account_id=account)<>1 or (select posted_at from private.stock_movements where account_id=account)<>stamp then raise exception 'Source reposted or timestamp changed'; end if;
  begin perform pg_temp.stock_action(actor,a,jsonb_build_array(posting||'{"quantity":"19"}')); raise exception 'Source changed'; exception when check_violation then null; end;
  -- Case/outer spaces group, inner spaces and unit aliases remain distinct.
  begin perform pg_temp.stock_action(actor,jsonb_build_array(pg_temp.stock_account(second,project,' CEMENT ',' BAG ')),jsonb_build_array(pg_temp.stock_posting(second,'1'))); raise exception 'Duplicate identity created'; exception when unique_violation then null; end;
  perform pg_temp.stock_action(actor,jsonb_build_array(pg_temp.stock_account(second,project,'Cement','bags'),pg_temp.stock_account(third,project,'Ce  ment')),
    jsonb_build_array(pg_temp.stock_posting(second,'0.1'),pg_temp.stock_posting(third,'0.2')));
  hold:=jsonb_build_object('reservationId',reservation,'accountId',account,'ownerKind','transfer','ownerId',gen_random_uuid(),'ownerLineId',gen_random_uuid(),'quantity','8');
  a:=jsonb_build_array(pg_temp.stock_account(account,project));
  result:=pg_temp.stock_action(actor,a,'[]',jsonb_build_array(hold));
  if result->'accounts'->0->>'available'<>'10' then raise exception 'Reservation not counted'; end if;
  begin perform pg_temp.stock_action(actor,a,'[]',jsonb_build_array(hold)); raise exception 'Stale stock save'; exception when serialization_failure then null; end;
  count_before:=(select count(*) from private.stock_events);
  a:=jsonb_build_array(pg_temp.stock_account(account,project));
  result:=pg_temp.stock_action(actor,a,'[]',jsonb_build_array(hold));
  if result->>'changed'<>'false' or (select count(*) from private.stock_events)<>count_before then raise exception 'No-op created event'; end if;
  begin perform pg_temp.stock_action(actor,a,jsonb_build_array(pg_temp.stock_posting(account,'-11','usage'))); raise exception 'Usage consumed reservations'; exception when check_violation then null; end;
  begin perform pg_temp.stock_action(actor,a,jsonb_build_array(pg_temp.stock_posting(account,'-3','dispatch',gen_random_uuid(),gen_random_uuid(),reservation))); raise exception 'Dispatch did not consume reservation'; exception when check_violation then null; end;
  posting:=pg_temp.stock_posting(account,'-3','dispatch',gen_random_uuid(),gen_random_uuid(),reservation);
  result:=pg_temp.stock_action(actor,a,jsonb_build_array(posting),jsonb_build_array(hold||'{"quantity":"5"}'));
  if result->'accounts'->0->>'available'<>'10' or result->'accounts'->0->>'onHand'<>'15' then raise exception 'Dispatch conversion changed free stock'; end if;
  if pg_temp.stock_action(actor,a,jsonb_build_array(posting),jsonb_build_array(hold||'{"quantity":"5"}'))<>result then raise exception 'Dispatch source replay changed'; end if;
  a:=jsonb_build_array(pg_temp.stock_account(account,project));
  begin perform pg_temp.stock_action(actor,a,jsonb_build_array(pg_temp.stock_posting(account,'-11','adjustment'))); raise exception 'Correction left uncovered reservations'; exception when check_violation then null; end;
  result:=pg_temp.stock_action(actor,a,jsonb_build_array(pg_temp.stock_posting(account,'-15','adjustment')),jsonb_build_array(hold||'{"quantity":"0"}'));
  if result->'accounts'->0->>'onHand'<>'0' then raise exception 'Explicit cancellation/correction failed'; end if;
  perform pg_temp.stock_action(actor,jsonb_build_array(pg_temp.stock_account(account,project)),jsonb_build_array(pg_temp.stock_posting(account,'1')));
  if (select count(*) from private.stock_accounts where id=account)<>1 then raise exception 'Zero identity lost'; end if;
  begin delete from public.projects where id=project; raise exception 'Stock project deleted'; exception when foreign_key_violation then null; end;
  begin update private.stock_accounts set description='Rewrite' where id=account; raise exception 'Account renamed'; exception when check_violation then null; end;
  begin update private.stock_movements set quantity=99 where account_id=account; raise exception 'Movement edited'; exception when check_violation then null; end;
  begin delete from private.stock_reservations where id=reservation; raise exception 'Reservation erased'; exception when check_violation then null; end;
  begin update private.stock_events set actor_name='Rewrite'; raise exception 'History edited'; exception when check_violation then null; end;
  -- All grouped writes, first account creation and source receipts roll back.
  original:=private.stock_snapshot(array[account,second,third]); count_before:=(select count(*) from private.stock_operations);
  begin
    perform pg_temp.stock_action(actor,jsonb_build_array(pg_temp.stock_account(failed,project,'First failed'),pg_temp.stock_account(second,project,'Cement','bags')),
      jsonb_build_array(pg_temp.stock_posting(failed,'1'),pg_temp.stock_posting(second,'-1','usage')));
    raise exception 'Grouped overspend accepted';
  exception when check_violation then null; end;
  if exists(select 1 from private.stock_accounts where id=failed) or private.stock_snapshot(array[account,second,third])<>original
    or (select count(*) from private.stock_operations)<>count_before then raise exception 'Failed batch leaked'; end if;
  begin
    perform pg_temp.stock_action(actor,jsonb_build_array(pg_temp.stock_account(failed,project,'First failed')),jsonb_build_array(pg_temp.stock_posting(failed,'1')));
    raise exception using errcode='P4701';
  exception when sqlstate 'P4701' then null; end;
  if exists(select 1 from private.stock_accounts where id=failed) then raise exception 'Owning transaction leaked account'; end if;
  -- Exact fractional totals and no forged date.
  perform pg_temp.stock_action(actor,jsonb_build_array(pg_temp.stock_account(second,project,'Cement','bags')),jsonb_build_array(pg_temp.stock_posting(second,'0.2')));
  if private.stock_snapshot(array[second])->0->>'onHand'<>'0.3' then raise exception 'Fractions rounded'; end if;
  foreach candidate in array array['{"quantity":"-0.30000000000000000000001"}'::jsonb,'{"quantity":"NaN"}','{"quantity":null}','{"postedAt":"2000-01-01"}'] loop
    begin perform pg_temp.stock_action(actor,jsonb_build_array(pg_temp.stock_account(second,project,'Cement','bags')),
      jsonb_build_array(pg_temp.stock_posting(second,'1','adjustment')||candidate)); raise exception 'Invalid quantity/date accepted'; exception when check_violation then null; end;
  end loop;
  -- Real Site actor can access assigned project only; no role impersonation.
  perform pg_temp.stock_action(actor,jsonb_build_array(pg_temp.stock_account(failed,project,repeat('x',4000),repeat('u',4000))),
    jsonb_build_array(pg_temp.stock_posting(failed,'1')));
  perform pg_temp.stock_action(f->'siteActor',jsonb_build_array(pg_temp.stock_account(account,project)),jsonb_build_array(pg_temp.stock_posting(account,'-1','usage')));
  begin perform pg_temp.stock_action(f->'siteActor',jsonb_build_array(pg_temp.stock_account(failed,(f->>'otherProject')::uuid)),jsonb_build_array(pg_temp.stock_posting(failed,'1'))); raise exception 'Foreign project accessed'; exception when insufficient_privilege then null; end;
  delete from private.session_bindings where session_id=(actor->>'sessionId')::uuid;
  begin perform pg_temp.stock_action(actor,a,jsonb_build_array(posting)); raise exception 'Revoked actor accepted'; exception when insufficient_privilege then null; end;
end $$;
do $$ declare role_name text; table_name text; begin
  foreach role_name in array array['anon','authenticated','service_role'] loop
    foreach table_name in array array['stock_accounts','stock_movements','stock_reservations','stock_operations','stock_events'] loop
      if has_table_privilege(role_name,'private.'||table_name,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Stock table exposed'; end if;
    end loop;
    if has_function_privilege(role_name,'private.stock_apply(jsonb,uuid,jsonb,jsonb,jsonb,text)','EXECUTE')
      or has_function_privilege(role_name,'private.stock_snapshot(uuid[])','EXECUTE') then raise exception 'Stock function exposed'; end if;
  end loop;
end $$;
rollback;
