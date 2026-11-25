-- Rollback-only job, access and source-version fixture.
begin;
set local statement_timeout='30s';
do $$
declare
  site_id uuid := gen_random_uuid();
  peer_id uuid := gen_random_uuid();
  uid uuid;
  sid uuid;
  proof jsonb;
  actors jsonb := '{}';
  site jsonb;
  peer jsonb;
  project uuid := gen_random_uuid();
  scope uuid := gen_random_uuid();
  mapping uuid := gen_random_uuid();
  doc uuid := gen_random_uuid();
  large_doc uuid := gen_random_uuid();
  target uuid;
  job uuid;
  lease uuid;
  saved jsonb;
  context jsonb;
  input jsonb;
  reply jsonb;
  write_command jsonb;
  submission jsonb;
  form jsonb := '{"scopeId":null,"requestDate":"","sourceRef":"","requestedBy":"","approvedBy":"","purchaser":"","financeOfficer":"","specialInstructions":"","items":[]}';
  proposal jsonb := '{"details":{"requestedBy":{"value":"Printed fixture","page":1}},"rows":[]}';
begin
  if has_table_privilege('authenticated','private.mrf_extraction_jobs','SELECT')
    or has_function_privilege('authenticated','public.mrf_extraction_worker(uuid,text,uuid,jsonb)','EXECUTE')
    or has_function_privilege('anon','public.mrf_extraction_command(jsonb,jsonb)','EXECUTE') then
    raise exception 'Extraction state or worker exposed to a client role';
  end if;
  insert into public.projects(id,name,location,document_code)
    values(project,'Extraction fixture '||project,'Site','EX-'||upper(substr(project::text,1,8)));
  insert into public.project_budgets values(project,100);
  insert into public.scopes(id,project_id,name) values(scope,project,'Autofill verification');
  insert into public.scope_budgets values(scope,100);
  for uid in select unnest(array[site_id,peer_id]) loop
    sid:=gen_random_uuid();
    insert into auth.users(id,email,is_anonymous,email_confirmed_at,encrypted_password) values(uid,uid||'@example.invalid',false,now(),'fixture');
    insert into public.profiles(user_id,display_name,is_active) values(uid,'Extraction fixture',true);
    insert into public.role_grants values(uid,'Site Personnel');
    insert into public.project_assignments values(uid,project);
    insert into auth.sessions(id,user_id,created_at,updated_at) values(sid,uid,now(),now());
    proof:=private.login_preflight(uid||'@example.invalid');
    perform private.bind_session(uid,sid,proof->>'revision',proof->>'credential');
    actors:=actors||jsonb_build_object(uid::text,jsonb_build_object('userId',uid,'sessionId',sid,'revision',proof->>'revision','activeRole','Site Personnel'));
  end loop;
  site:=actors->site_id::text;
  peer:=actors->peer_id::text;
  saved:=public.request_command(site,jsonb_build_object('type','createDraft','requestId',gen_random_uuid(),'projectId',project,'draft',form))->'record';
  target:=(saved->>'id')::uuid;
  insert into private.project_document_folders(id,project_id,folder_id,root_id,name)
    values(mapping,project,'ex-folder-'||project,'fixture-root','Fixture');
  insert into private.request_documents(id,request_id,folder_mapping_id,drive_file_id,name,size,sha256,uploader_id,uploader_name)
    values(doc,target,mapping,'ex-file-'||doc,'support.pdf',10,repeat('a',64),site_id,'Fixture');
  insert into private.request_documents(id,request_id,folder_mapping_id,drive_file_id,name,size,sha256,uploader_id,uploader_name)
    values(large_doc,target,mapping,'ex-file-'||large_doc,'large-support.pdf',10000001,repeat('b',64),site_id,'Fixture');
  insert into private.request_document_state values(target,1,large_doc);
  context:=jsonb_build_object('mrfId',target,'version',saved->>'version','attachmentRevision','2');
  input:=context||jsonb_build_object('type','start','operationId',gen_random_uuid());
  if public.mrf_extraction_command(site,input||'{"attachmentRevision":"1"}')->>'reason' is distinct from 'limit' then raise exception 'Oversized PDF admitted'; end if;
  if exists(select 1 from private.mrf_extraction_jobs where request_id=target) then raise exception 'Oversized PDF enqueued'; end if;
  update private.request_document_state set revision=2,current_document=doc where request_id=target;
  reply:=public.mrf_extraction_command(site,input);
  job:=(reply->>'id')::uuid;
  if reply->>'state' is distinct from 'pending' or reply->>'dispatch' is distinct from 'true' then raise exception 'Missing job admission'; end if;
  reply:=public.mrf_extraction_command(site,input||jsonb_build_object('operationId',gen_random_uuid()));
  if reply->>'id' is distinct from job::text or reply->>'dispatch' is distinct from 'false' then raise exception 'Duplicate dispatch or proposal'; end if;
  reply:=public.mrf_extraction_worker(job,'claim',null,'{}');
  lease:=(reply->>'lease')::uuid;
  if lease is null or public.mrf_extraction_worker(job,'claim',null,'{}') is not null then raise exception 'Lease does not serialize workers'; end if;
  perform public.mrf_extraction_worker(job,'fail',lease,'{"reason":"provider"}');
  input:=context||jsonb_build_object('type','retry','proposalId',job,'attemptId',input->>'operationId','operationId',gen_random_uuid());
  if public.mrf_extraction_command(site,input)->>'attemptId' is distinct from input->>'operationId'
    or public.mrf_extraction_command(site,input)->>'attemptId' is distinct from input->>'operationId' then raise exception 'Retry identity was not stable'; end if;
  lease:=(public.mrf_extraction_worker(job,'claim',null,'{}')->>'lease')::uuid;
  if public.mrf_extraction_worker(job,'complete',lease,proposal)->>'expiresAt' is null then raise exception 'Proposal did not complete'; end if;
  if public.mrf_extraction_command(peer,context||'{"type":"status"}')->>'state' is distinct from 'idle' then raise exception 'Proposal leaked to colleague'; end if;
  if public.mrf_extraction_command(site,context||jsonb_build_object('type','apply','proposalId',job))->'proposal' is distinct from proposal then raise exception 'Owner cannot recover proposal'; end if;
  write_command:=jsonb_build_object('type','saveDraft','requestId',gen_random_uuid(),'mrfId',target,'expectedVersion',saved->>'version',
    'draft',form||'{"requestedBy":"Printed fixture"}','extractionProposalId',job);
  begin perform public.request_command(peer,write_command); raise exception 'Colleague saved private proposal'; exception when sqlstate 'P4350' then null; end;
  update private.request_document_state set revision=3 where request_id=target;
  begin perform public.request_command(site,write_command); raise exception 'Old PDF proposal saved'; exception when sqlstate 'P4350' then null; end;
  begin
    perform public.request_command(site,write_command||jsonb_build_object('type','submitMrf','attachmentRevision','3','requestId',gen_random_uuid()));
    raise exception 'Submission accepted an autofill tied to a previous PDF';
  exception when sqlstate 'P4350' then null; end;
  context:=context||'{"attachmentRevision":"3"}';
  reply:=public.mrf_extraction_command(site,context||jsonb_build_object('type','start','operationId',gen_random_uuid()));
  job:=(reply->>'id')::uuid;
  lease:=(public.mrf_extraction_worker(job,'claim',null,'{}')->>'lease')::uuid;
  perform public.mrf_extraction_worker(job,'complete',lease,proposal);
  update private.mrf_extraction_jobs set expires_at=clock_timestamp()-interval '1 second' where id=job;
  perform public.mrf_extraction_worker(job,'purge',null,'{}');
  if (select j.state <> 'expired' or j.proposal is not null from private.mrf_extraction_jobs j where j.id=job) then raise exception 'Expired payload retained'; end if;
  reply:=public.mrf_extraction_command(site,context||jsonb_build_object('type','retry','proposalId',job,'attemptId',reply->>'attemptId','operationId',gen_random_uuid()));
  lease:=(public.mrf_extraction_worker(job,'claim',null,'{}')->>'lease')::uuid;
  perform public.mrf_extraction_worker(job,'complete',lease,proposal);
  write_command:=write_command||jsonb_build_object('extractionProposalId',job);
  saved:=public.request_command(site,write_command);
  if saved->'record'->'draft'->>'requestedBy' is distinct from 'Printed fixture' then raise exception 'Selected edit did not save'; end if;
  if public.request_command(site,write_command) is distinct from saved then raise exception 'Saved response not recoverable after version change'; end if;
  if public.mrf_extraction_command(site,context||'{"type":"status"}')->>'state' is distinct from 'stale' then raise exception 'Old draft proposal available'; end if;
  context:=context||jsonb_build_object('version',saved->'record'->>'version');
  reply:=public.mrf_extraction_command(site,context||jsonb_build_object('type','start','operationId',gen_random_uuid()));
  job:=(reply->>'id')::uuid;
  lease:=(public.mrf_extraction_worker(job,'claim',null,'{}')->>'lease')::uuid;
  begin
    delete from public.project_assignments where user_id=site_id and project_id=project;
    if public.mrf_extraction_worker(job,'complete',lease,proposal) is not null then raise exception 'Revoked worker published a proposal'; end if;
    begin perform public.mrf_extraction_command(site,context||'{"type":"status"}'); raise exception 'Revoked editor read a proposal'; exception when insufficient_privilege then null; end;
    raise exception 'Restore fixture assignment' using errcode='P9499';
  exception when sqlstate 'P9499' then null; end;
  perform public.mrf_extraction_worker(job,'complete',lease,proposal);
  write_command:=jsonb_build_object('type','submitMrf','requestId',gen_random_uuid(),'mrfId',target,'expectedVersion',context->>'version',
    'attachmentRevision','3','draft',form||jsonb_build_object('scopeId',scope),'extractionProposalId',job);
  begin perform public.request_command(peer,write_command); raise exception 'Colleague submitted private autofill'; exception when sqlstate 'P4350' then null; end;
  begin perform public.request_command(site,write_command); raise exception 'Autofill bypassed form validation'; exception when sqlstate 'P4302' then null; end;
  if private.request_snapshot(target)->>'version' is distinct from context->>'version' then raise exception 'Failed submission persisted changes'; end if;
  write_command:=write_command||jsonb_build_object('draft',form||jsonb_build_object(
    'scopeId',scope,'requestDate','2026-11-25','requestedBy','Printed fixture','approvedBy','Printed PM',
    'purchaser','Printed buyer','financeOfficer','Printed finance','items',jsonb_build_array(jsonb_build_object(
      'id',gen_random_uuid(),'name','Steel mesh','quantity','3.625','unit','sheet','neededDate','2026-11-28','location','Site','remarks','','purpose',''))));
  begin
    delete from public.project_assignments where user_id=site_id and project_id=project;
    begin perform public.request_command(site,write_command); raise exception 'Revoked editor submitted autofill'; exception when insufficient_privilege then null; end;
    raise exception 'Restore fixture assignment' using errcode='P9499';
  exception when sqlstate 'P9499' then null; end;
  submission:=public.request_command(site,write_command);
  if submission->'record'->>'status' is distinct from 'submitted'
    or submission->'record'->'draft'->'items'->0->>'quantity' is distinct from '3.625' then
    raise exception 'Valid autofill did not save and submit atomically';
  end if;
  if public.request_command(site,write_command) is distinct from submission then raise exception 'Submission response not recoverable after version change'; end if;
  if (select count(*) from private.mrf_submissions where request_id=target)<>1 then raise exception 'Duplicate autofilled submission'; end if;
end $$;
rollback;
