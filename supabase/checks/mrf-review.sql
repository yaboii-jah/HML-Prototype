-- Rollback-only lifecycle/security fixture; real provider execution has separate coverage.
begin;
set local statement_timeout='30s';
do $$
declare
  site_a uuid:=gen_random_uuid(); site_b uuid:=gen_random_uuid(); pm_id uuid:=gen_random_uuid(); procurement_id uuid:=gen_random_uuid();
  uid uuid; sid uuid; proof jsonb; actors jsonb:='{}'; site jsonb; manager jsonb; procurement jsonb;
  project uuid:=gen_random_uuid(); scope uuid:=gen_random_uuid(); mrf uuid; document uuid:=gen_random_uuid(); mapping uuid:=gen_random_uuid();
  form jsonb; saved jsonb; command jsonb; result jsonb; first_result jsonb; archive_id uuid; job uuid; lease uuid; part jsonb; initial_version text;
begin
  insert into public.projects(id,name,location,document_code) values(project,'Review fixture '||project,'Original site','RV-'||upper(substr(project::text,1,8)));
  insert into public.project_budgets values(project,100);
  insert into public.scopes(id,project_id,name) values(scope,project,'Structural Works');
  insert into public.scope_budgets values(scope,100);
  for uid in select unnest(array[site_a,site_b,pm_id,procurement_id]) loop
    sid:=gen_random_uuid();
    insert into auth.users(id,email,is_anonymous,email_confirmed_at,encrypted_password) values(uid,uid||'@example.invalid',false,now(),'fixture');
    insert into public.profiles(user_id,display_name,is_active) values(uid,'Review fixture',true);
    insert into public.role_grants values(uid,case when uid=pm_id then 'Project Manager' when uid=procurement_id then 'Procurement' else 'Site Personnel' end);
    if uid in(site_a,site_b) then insert into public.project_assignments values(uid,project); end if;
    insert into auth.sessions(id,user_id,created_at,updated_at) values(sid,uid,now(),now());
    proof:=private.login_preflight(uid||'@example.invalid'); perform private.bind_session(uid,sid,proof->>'revision',proof->>'credential');
    actors:=actors||jsonb_build_object(uid::text,jsonb_build_object('userId',uid,'sessionId',sid,'revision',proof->>'revision','activeRole',
      case when uid=pm_id then 'Project Manager' when uid=procurement_id then 'Procurement' else 'Site Personnel' end));
  end loop;
  site:=actors->site_a::text; manager:=actors->pm_id::text; procurement:=actors->procurement_id::text;
  form:=jsonb_build_object('scopeId',scope,'requestDate','2026-11-03','sourceRef','','requestedBy','Site printed','approvedBy','PM printed','purchaser','Buyer printed','financeOfficer','Finance printed','specialInstructions','',
    'items',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'name','Cement','unit','bag','quantity','12.125','neededDate','2026-11-04','purpose','','location','Site','remarks','')));
  saved:=public.request_command(site,jsonb_build_object('type','createDraft','requestId',gen_random_uuid(),'projectId',project,'draft',form))->'record';
  mrf:=(saved->>'id')::uuid; initial_version:=saved->>'version';
  command:=jsonb_build_object('type','submitMrf','requestId',gen_random_uuid(),'mrfId',mrf,'expectedVersion',saved->>'version','draft',form,'attachmentRevision','2');
  begin perform public.request_command(site,command||jsonb_build_object('draft',form||'{"requestedBy":""}')); raise exception 'Incomplete submission accepted'; exception when sqlstate 'P4302' then null; end;
  if private.request_snapshot(mrf)->>'version'<>initial_version then raise exception 'Failed submit saved form'; end if;
  insert into private.project_document_folders(id,project_id,folder_id,root_id,name) values(mapping,project,'review-folder-'||project,'fixture-root','Fixture');
  insert into private.request_documents(id,request_id,folder_mapping_id,drive_file_id,name,size,sha256,uploader_id,uploader_name)
    values(document,mrf,mapping,'review-file-'||document,'support.pdf',10,repeat('a',64),site_a,'Original uploader');
  insert into private.request_document_state values(mrf,2,document);
  part:=jsonb_build_object('operationId',gen_random_uuid(),'mrfId',mrf,'type','startUpload','expectedRevision','2','name','pending.pdf','size',10,'sha256',repeat('b',64));
  result:=public.document_command(site,part);
  begin perform public.request_command(site,command); raise exception 'Pending upload allowed submit'; exception when sqlstate 'P4304' then null; end;
  perform public.document_command(site,jsonb_build_object('type','cancelUpload','operationId',gen_random_uuid(),'mrfId',mrf,'uploadId',result->>'uploadId'));
  first_result:=public.request_command(site,command);
  if public.request_command(site,command)<>first_result then raise exception 'Submission retry changed'; end if;
  saved:=first_result->'record';
  if saved->>'status'<>'submitted' or jsonb_array_length(saved->'history')<>1 then raise exception 'Submission not recorded once'; end if;
  begin perform public.request_command(site,jsonb_build_object('type','saveDraft','requestId',gen_random_uuid(),'mrfId',mrf,'expectedVersion',saved->>'version','draft',form)); raise exception 'Submitted form changed'; exception when sqlstate 'P4301' then null; end;
  begin perform public.document_command(site,part||jsonb_build_object('operationId',gen_random_uuid())); raise exception 'Submitted upload accepted'; exception when sqlstate 'P4301' then null; end;
  begin perform public.document_command(site,jsonb_build_object('type','remove','operationId',gen_random_uuid(),'mrfId',mrf,'expectedRevision','2')); raise exception 'Submitted PDF removed'; exception when sqlstate 'P4301' then null; end;
  command:=jsonb_build_object('type','reviewMrf','requestId',gen_random_uuid(),'mrfId',mrf,'expectedVersion',saved->>'version','submissionId',saved->>'submissionId','decision','return','reason','Clarify quantities');
  saved:=public.request_command(manager,command)->'record';
  site:=actors->site_b::text;
  saved:=public.request_command(site,jsonb_build_object('type','saveDraft','requestId',gen_random_uuid(),'mrfId',mrf,'expectedVersion',saved->>'version','draft',form||'{"specialInstructions":"Updated by colleague"}'))->'record';
  if saved->>'status'<>'returned' then raise exception 'Saving returned work erased status'; end if;
  form:=saved->'draft';
  saved:=public.request_command(site,jsonb_build_object('type','submitMrf','requestId',gen_random_uuid(),'mrfId',mrf,'expectedVersion',saved->>'version','draft',form,'attachmentRevision','2'))->'record';
  -- Both original and resubmitting identities remain barred after real role changes.
  for uid in select unnest(array[site_a,site_b]) loop
    delete from public.role_grants where user_id=uid;
    insert into public.role_grants values(uid,'Project Manager');
    sid:=((actors->uid::text)->>'sessionId')::uuid;
    delete from private.session_bindings where session_id=sid;
    proof:=private.login_preflight(uid||'@example.invalid'); perform private.bind_session(uid,sid,proof->>'revision',proof->>'credential');
    part:=(actors->uid::text)||jsonb_build_object('revision',proof->>'revision','activeRole','Project Manager');
    begin perform public.request_command(part,jsonb_build_object('type','reviewMrf','requestId',gen_random_uuid(),'mrfId',mrf,'expectedVersion',saved->>'version','submissionId',saved->>'submissionId','decision','approve')); raise exception 'Historical submitter approved'; exception when sqlstate 'P4306' then null; end;
    delete from public.role_grants where user_id=uid;
    insert into public.role_grants values(uid,'Site Personnel');
    delete from private.session_bindings where session_id=sid;
    proof:=private.login_preflight(uid||'@example.invalid'); perform private.bind_session(uid,sid,proof->>'revision',proof->>'credential');
    actors:=actors||jsonb_build_object(uid::text,(actors->uid::text)||jsonb_build_object('revision',proof->>'revision'));
  end loop;
  update public.projects set name='Renamed review fixture '||project,location='Changed site' where id=project;
  update public.scope_budgets set amount=0 where scope_id=scope;
  command:=jsonb_build_object('type','reviewMrf','requestId',gen_random_uuid(),'mrfId',mrf,'expectedVersion',saved->>'version','submissionId',saved->>'submissionId','decision','approve');
  begin perform public.request_command(manager,command); raise exception 'Unfunded approval accepted'; exception when sqlstate 'P4303' then null; end;
  update public.scope_budgets set amount=100 where scope_id=scope;
  result:=public.request_command(manager,command); saved:=result->'record';
  if public.request_command(manager,command)<>result then raise exception 'Approval retry changed'; end if;
  if saved->>'status'<>'approved' or private.mrf_ready(mrf) then raise exception 'Approval bypassed archive'; end if;
  select id into archive_id from private.mrf_archive_snapshots where request_id=mrf;
  if (select snapshot->>'projectLocation' from private.mrf_archive_snapshots where id=archive_id)<>'Original site' then raise exception 'Submitted labels changed'; end if;
  begin perform public.request_command(procurement,jsonb_build_object('type','openCorrection','requestId',gen_random_uuid(),'mrfId',mrf,'expectedVersion',saved->>'version','reason','Fix requirement')); raise exception 'Correction bypassed archive'; exception when sqlstate 'P4307' then null; end;
  select id into job from private.document_jobs where resource_id=archive_id and kind='archive';
  part:=public.document_worker(job,'claim'); lease:=(part->>'lease')::uuid;
  perform public.document_worker(job,'checkpoint',lease,jsonb_build_object('formFileId','fixture-form','supportingFileId','fixture-support','formSha256',repeat('b',64),'supportingSha256',repeat('a',64),'formSize',20,'supportingSize',10,'verified',true));
  perform public.document_worker(job,'complete',lease);
  if not private.mrf_ready(mrf) or (select count(*) from private.mrf_archive_files where snapshot_id=archive_id)<>2 then raise exception 'Verified pair not ready'; end if;
  saved:=public.request_command(procurement,jsonb_build_object('type','openCorrection','requestId',gen_random_uuid(),'mrfId',mrf,'expectedVersion',saved->>'version','reason','Fix requirement'))->'record';
  if saved->>'correctionKind'<>'full' or private.mrf_ready(mrf) then raise exception 'Full correction gate failed'; end if;
  site:=actors->site_b::text;
  saved:=public.request_command(site,jsonb_build_object('type','submitMrf','requestId',gen_random_uuid(),'mrfId',mrf,'expectedVersion',saved->>'version','draft',form,'attachmentRevision','2'))->'record';
  begin perform public.request_command(manager,jsonb_build_object('type','reviewMrf','requestId',gen_random_uuid(),'mrfId',mrf,'expectedVersion',saved->>'version','submissionId',saved->>'submissionId','decision','reject','reason','No rejection in correction')); raise exception 'Correction rejected'; exception when check_violation then null; end;
  saved:=public.request_command(manager,jsonb_build_object('type','reviewMrf','requestId',gen_random_uuid(),'mrfId',mrf,'expectedVersion',saved->>'version','submissionId',saved->>'submissionId','decision','approve'))->'record';
  select id into archive_id from private.mrf_archive_snapshots where request_id=mrf and version=2;
  select id into job from private.document_jobs where resource_id=archive_id;
  part:=public.document_worker(job,'claim'); lease:=(part->>'lease')::uuid;
  perform public.document_worker(job,'checkpoint',lease,jsonb_build_object('formFileId','fixture-form-v2','supportingFileId','fixture-support-v2','formSha256',repeat('b',64),'supportingSha256',repeat('a',64),'formSize',20,'supportingSize',10,'verified',true));
  perform public.document_worker(job,'complete',lease);
  perform private.mrf_register_downstream(mrf,'quotation',gen_random_uuid());
  saved:=public.request_command(procurement,jsonb_build_object('type','openCorrection','requestId',gen_random_uuid(),'mrfId',mrf,'expectedVersion',saved->>'version','reason','Correct supporting PDF'))->'record';
  if saved->>'correctionKind'<>'documents' then raise exception 'Downstream reference allowed full correction'; end if;
  update public.scope_budgets set amount=0 where scope_id=scope;
  begin perform public.request_command(site,jsonb_build_object('type','submitMrf','requestId',gen_random_uuid(),'mrfId',mrf,'expectedVersion',saved->>'version','draft',form||'{"requestedBy":"Changed"}','attachmentRevision','2')); raise exception 'Document-only form changed'; exception when sqlstate 'P4301' then null; end;
  saved:=public.request_command(site,jsonb_build_object('type','submitMrf','requestId',gen_random_uuid(),'mrfId',mrf,'expectedVersion',saved->>'version','draft',form,'attachmentRevision','2'))->'record';
  saved:=public.request_command(manager,jsonb_build_object('type','reviewMrf','requestId',gen_random_uuid(),'mrfId',mrf,'expectedVersion',saved->>'version','submissionId',saved->>'submissionId','decision','approve'))->'record';
  if (select count(*) from private.mrf_archive_snapshots where request_id=mrf)<>3 then raise exception 'Approval history lost'; end if;
  -- Initial rejection is terminal, unlike correction returns.
  update public.scope_budgets set amount=100 where scope_id=scope;
  saved:=public.request_command(site,jsonb_build_object('type','createDraft','requestId',gen_random_uuid(),'projectId',project,'draft',form||jsonb_build_object('items',jsonb_build_array((form->'items'->0)||jsonb_build_object('id',gen_random_uuid())))))->'record';
  mrf:=(saved->>'id')::uuid; document:=gen_random_uuid(); form:=saved->'draft';
  insert into private.request_documents(id,request_id,folder_mapping_id,drive_file_id,name,size,sha256,uploader_id,uploader_name)
    values(document,mrf,mapping,'reject-file-'||document,'reject.pdf',10,repeat('a',64),site_b,'Fixture');
  insert into private.request_document_state values(mrf,1,document);
  saved:=public.request_command(site,jsonb_build_object('type','submitMrf','requestId',gen_random_uuid(),'mrfId',mrf,'expectedVersion',saved->>'version','draft',form,'attachmentRevision','1'))->'record';
  saved:=public.request_command(manager,jsonb_build_object('type','reviewMrf','requestId',gen_random_uuid(),'mrfId',mrf,'expectedVersion',saved->>'version','submissionId',saved->>'submissionId','decision','reject','reason','Rejected requirement'))->'record';
  if saved->>'status'<>'rejected' then raise exception 'Rejection missing'; end if;
  begin perform public.request_command(site,jsonb_build_object('type','saveDraft','requestId',gen_random_uuid(),'mrfId',mrf,'expectedVersion',saved->>'version','draft',form)); raise exception 'Rejected request edited'; exception when sqlstate 'P4301' then null; end;
  begin perform public.request_command(procurement,jsonb_build_object('type','openCorrection','requestId',gen_random_uuid(),'mrfId',mrf,'expectedVersion',saved->>'version','reason','Reopen rejected')); raise exception 'Rejected request reopened'; exception when sqlstate 'P4307' then null; end;
  if has_table_privilege('service_role','private.mrf_submissions','insert') or has_function_privilege('authenticated','public.document_source_file(jsonb,uuid)','execute') then raise exception 'Private history leak'; end if;
end $$;
rollback;
