-- Rollback-only metadata/security checks. Provider verification is exercised by CI.
begin;
set local statement_timeout='30s';
do $$
declare
  admin_id uuid:=gen_random_uuid(); site_id uuid:=gen_random_uuid(); admin_session uuid:=gen_random_uuid(); site_session uuid:=gen_random_uuid();
  caller uuid; sid uuid; proof jsonb; admin jsonb; site jsonb; project uuid; mrf uuid; draft jsonb; command jsonb; result jsonb;
  folder_job uuid; job uuid; lease uuid; upload_a uuid; upload_b uuid; receipt jsonb; mapping uuid; before_version text; signature text; upload_target uuid;
begin
  foreach signature in array array['public.documents_read(jsonb,uuid,uuid)','public.document_command(jsonb,jsonb)',
    'public.document_transfer(jsonb,uuid,text,uuid,jsonb)','public.document_worker(uuid,text,uuid,jsonb)','public.document_dispatch(uuid)','public.document_file(jsonb,uuid)'] loop
    if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute') or not has_function_privilege('service_role',signature,'execute') then raise exception 'Document RPC privilege leak'; end if;
  end loop;
  foreach signature in array array['project_document_folders','document_folder_owners','request_document_state','request_documents','document_uploads','document_jobs','document_operations','mrf_archive_snapshots','mrf_archives'] loop
    if has_table_privilege('authenticated','private.'||signature,'select') or has_table_privilege('service_role','private.'||signature,'insert') then raise exception 'Document table leak'; end if;
  end loop;
  insert into auth.users(id,email,is_anonymous,email_confirmed_at,encrypted_password) values(admin_id,admin_id::text||'@example.invalid',false,now(),'fixture'),(site_id,site_id::text||'@example.invalid',false,now(),'fixture');
  insert into public.profiles(user_id,display_name,is_active) values(admin_id,'Documents Admin',true),(site_id,'Documents Site',true);
  insert into public.role_grants values(admin_id,'Administrator'),(site_id,'Site Personnel');
  insert into auth.sessions(id,user_id,created_at,updated_at) values(admin_session,admin_id,now(),now()),(site_session,site_id,now(),now());
  for caller,sid in select * from (values(admin_id,admin_session),(site_id,site_session)) v loop
    proof:=private.login_preflight(caller::text||'@example.invalid');
    perform private.bind_session(caller,sid,proof->>'revision',proof->>'credential');
  end loop;
  select jsonb_build_object('userId',admin_id,'sessionId',admin_session,'revision',access_revision::text,'activeRole','Administrator') into admin from public.profiles where user_id=admin_id;
  project:=(public.project_command(admin,jsonb_build_object('type','createProject','requestId',gen_random_uuid(),'name','Document checks '||gen_random_uuid(),'location','CI','code','D-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),'budget','0'))->>'projectId')::uuid;
  select id into folder_job from private.document_jobs where project_id=project and kind='folder';
  if folder_job is null then raise exception 'New project did not atomically enqueue folder setup'; end if;
  receipt:=public.document_worker(folder_job,'claim'); lease:=(receipt->>'lease')::uuid;
  if public.document_worker(folder_job,'claim') is not null then raise exception 'Duplicate worker claimed active lease'; end if;
  perform public.document_worker(folder_job,'checkpoint',lease,jsonb_build_object('folderId','sql-folder-'||project,'rootId','sql-test-root','name','SQL destination','verified',true));
  perform public.document_worker(folder_job,'complete',lease);
  perform public.document_worker(folder_job,'complete',lease);
  select id into mapping from private.project_document_folders where project_id=project and current;
  if mapping is null or (select count(*) from private.project_document_folders where project_id=project)<>1 then raise exception 'Folder acknowledgement duplicated'; end if;
  insert into public.project_assignments values(site_id,project);
  proof:=private.login_preflight(site_id::text||'@example.invalid'); delete from private.session_bindings where session_id=site_session;
  perform private.bind_session(site_id,site_session,proof->>'revision',proof->>'credential');
  site:=jsonb_build_object('userId',site_id,'sessionId',site_session,'revision',proof->>'revision','activeRole','Site Personnel');
  draft:='{"scopeId":null,"requestDate":"","sourceRef":"","requestedBy":"","approvedBy":"","purchaser":"","financeOfficer":"","specialInstructions":"","items":[]}';
  result:=public.request_command(site,jsonb_build_object('type','createDraft','requestId',gen_random_uuid(),'projectId',project,'draft',draft));
  mrf:=(result->'record'->>'id')::uuid; before_version:=result->'record'->>'version';
  command:=jsonb_build_object('type','startUpload','operationId',gen_random_uuid(),'mrfId',mrf,'expectedRevision','1','name','support.pdf','size',10,'sha256',repeat('a',64));
  result:=public.document_command(site,command); upload_a:=(result->>'uploadId')::uuid;
  if public.document_command(site,command)<>result then raise exception 'Upload retry duplicated'; end if;
  begin perform public.document_command(site,command||'{"name":"changed.pdf"}'); raise exception 'Operation reused'; exception when sqlstate 'P3406' then null; end;
  begin perform public.document_command(admin,command||jsonb_build_object('operationId',gen_random_uuid())); raise exception 'Admin uploaded'; exception when insufficient_privilege then null; end;
  upload_b:=(public.document_command(site,command||jsonb_build_object('operationId',gen_random_uuid()))->>'uploadId')::uuid;
  foreach upload_target in array array[upload_a,upload_b] loop
    receipt:=public.document_transfer(site,upload_target,'claim'); lease:=(receipt->>'lease')::uuid;
    begin perform public.document_transfer(site,upload_target,'claim'); raise exception 'Duplicate transfer lease'; exception when lock_not_available then null; end;
    perform public.document_transfer(site,upload_target,'checkpoint',lease,jsonb_build_object('driveFileId','sql-file-'||upload_target));
    perform public.document_transfer(site,upload_target,'finish',lease);
  end loop;
  foreach upload_target in array array[upload_a,upload_b] loop
    select j.id into job from private.document_jobs j where resource_id=upload_target and kind='validate';
    receipt:=public.document_worker(job,'claim'); lease:=(receipt->>'lease')::uuid;
    perform public.document_worker(job,'checkpoint',lease,jsonb_build_object('fileId','sql-file-'||upload_target,'size','10','sha256',repeat('a',64),'readable',true));
    perform public.document_worker(job,'complete',lease);
  end loop;
  if (select current_document from private.request_document_state where request_id=mrf)<>upload_a or (select state from private.document_uploads where id=upload_b)<>'conflict' then raise exception 'Stale upload replaced current'; end if;
  if private.request_snapshot(mrf)->>'version'<>before_version then raise exception 'Attachment changed header version'; end if;
  if private.documents_read(site,mrf,null)->>'revision'<>'2' then raise exception 'Attachment revision not advanced'; end if;
  begin perform public.document_command(site,jsonb_build_object('type','remove','mrfId',mrf,'operationId',gen_random_uuid(),'expectedRevision','1')); raise exception 'Stale remove accepted'; exception when serialization_failure then null; end;
  if public.document_file(site,upload_a)->>'name'<>'support.pdf' then raise exception 'Current document read failed'; end if;
  -- A future approved snapshot prevents cleanup forever, even after replacement/removal.
  insert into private.mrf_archive_snapshots(id,request_id,version,source_document,request_version,attachment_revision,snapshot,approved_by,approved_name,approved_at)
    values(gen_random_uuid(),mrf,1,upload_a,1,2,'{}',admin_id,'Documents Admin',now());
  perform public.document_command(site,jsonb_build_object('type','remove','mrfId',mrf,'operationId',gen_random_uuid(),'expectedRevision','2'));
  select j.id into job from private.document_jobs j where resource_id=upload_a and kind='cleanup';
  if public.document_worker(job,'claim') is not null then raise exception 'Approved version eligible for trash'; end if;
  begin update private.mrf_archive_snapshots set snapshot='{"forged":true}' where source_document=upload_a; raise exception 'Approved snapshot changed'; exception when check_violation then null; end;
  -- Revocation pauses admitted background work and invalidates the original session.
  select j.id into job from private.document_jobs j where resource_id=upload_b and kind='cleanup';
  delete from public.project_assignments where user_id=site_id and project_id=project;
  if public.document_worker(job,'claim') is not null or (select state from private.document_jobs where id=job)<>'paused' then raise exception 'Revoked worker continued'; end if;
  begin perform public.document_file(site,upload_a); raise exception 'Revoked file read accepted'; exception when insufficient_privilege then null; end;
end $$;
rollback;
