-- Rollback-only checked-command fixture. Actual decoding/provider work is tested separately.
begin;
set local statement_timeout='45s';
do $$
declare
  site_id uuid:=gen_random_uuid(); pm_id uuid:=gen_random_uuid(); buyer_id uuid:=gen_random_uuid(); reader_id uuid:=gen_random_uuid();
  uid uuid; sid uuid; proof jsonb; actors jsonb:='{}'; site jsonb; manager jsonb; buyer jsonb; reader jsonb;
  project uuid:=gen_random_uuid(); scope uuid:=gen_random_uuid(); mapping uuid:=gen_random_uuid(); document uuid:=gen_random_uuid();
  mrf uuid; supplier uuid; quote uuid; other_quote uuid; archive uuid; job uuid; lease uuid; target_group uuid; fid uuid; retained_file uuid;
  form jsonb; body jsonb:='{}'; line jsonb:='{}'; saved jsonb; command jsonb; result jsonb; receipt jsonb; part jsonb; k text; v text; fv text; reader_role text;
begin
  insert into public.projects(id,name,location,document_code) values(project,'Quotation fixture '||project,'Site','QT-'||upper(substr(project::text,1,8)));
  insert into public.project_budgets values(project,100);
  insert into public.scopes(id,project_id,name) values(scope,project,'Structural Works');
  insert into public.scope_budgets values(scope,100);
  for uid in select unnest(array[site_id,pm_id,buyer_id,reader_id]) loop
    sid:=gen_random_uuid();
    insert into auth.users(id,email,is_anonymous,email_confirmed_at,encrypted_password) values(uid,uid||'@example.invalid',false,now(),'fixture');
    insert into public.profiles(user_id,display_name,is_active) values(uid,'Quotation fixture',true);
    insert into public.role_grants values(uid,case uid when pm_id then 'Project Manager' when buyer_id then 'Procurement' when reader_id then 'Accounting' else 'Site Personnel' end);
    if uid=site_id then insert into public.project_assignments values(uid,project); end if;
    insert into auth.sessions(id,user_id,created_at,updated_at) values(sid,uid,now(),now());
    proof:=private.login_preflight(uid||'@example.invalid'); perform private.bind_session(uid,sid,proof->>'revision',proof->>'credential');
    actors:=actors||jsonb_build_object(uid::text,jsonb_build_object('userId',uid,'sessionId',sid,'revision',proof->>'revision','activeRole',
      case uid when pm_id then 'Project Manager' when buyer_id then 'Procurement' when reader_id then 'Accounting' else 'Site Personnel' end));
  end loop;
  site:=actors->site_id::text; manager:=actors->pm_id::text; buyer:=actors->buyer_id::text; reader:=actors->reader_id::text;
  form:=jsonb_build_object('scopeId',scope,'requestDate','2026-11-04','sourceRef','','requestedBy','Site','approvedBy','PM','purchaser','Buyer','financeOfficer','Finance','specialInstructions','',
    'items',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'name','Cement','unit','bag','quantity','12.125','neededDate','2026-11-05','purpose','','location','Site','remarks','')));
  saved:=public.request_command(site,jsonb_build_object('type','createDraft','requestId',gen_random_uuid(),'projectId',project,'draft',form))->'record';
  mrf:=(saved->>'id')::uuid;
  insert into private.project_document_folders(id,project_id,folder_id,root_id,name) values(mapping,project,'quote-folder-'||project,'fixture-root','Fixture');
  insert into private.request_documents(id,request_id,folder_mapping_id,drive_file_id,name,size,sha256,uploader_id,uploader_name)
    values(document,mrf,mapping,'fixture-support-'||document,'support.pdf',10,repeat('a',64),site_id,'Original uploader');
  insert into private.request_document_state values(mrf,2,document);
  supplier:=(public.supplier_command(buyer,jsonb_build_object('type','createSupplier','requestId',gen_random_uuid(),'profile',jsonb_build_object(
    'name','Quotation supplier '||project,'address','','tin','','contactName','','email','','phone','','accreditationNote','')))->>'supplierId')::uuid;
  foreach k in array array['supplierName','address','tin','contactName','email','phone','ref','date','validUntil','currency','paymentTerms','deliveryTerms','availability','leadDays','notes','taxStatus','priceBasis','financialNotes','vatRate','printedSubtotal','printedTax','printedTotal'] loop
    body:=body||jsonb_build_object(k,'');
  end loop;
  body:=body||'{"lines":[],"adjustments":[]}';
  command:=jsonb_build_object('type','create','requestId',gen_random_uuid(),'mrfId',mrf,'supplierId',supplier,'body',body);
  begin perform public.quotation_command(buyer,command); raise exception 'Unapproved MRF accepted'; exception when check_violation then null; end;
  saved:=public.request_command(site,jsonb_build_object('type','submitMrf','requestId',gen_random_uuid(),'mrfId',mrf,'expectedVersion',saved->>'version','draft',form,'attachmentRevision','2'))->'record';
  saved:=public.request_command(manager,jsonb_build_object('type','reviewMrf','requestId',gen_random_uuid(),'mrfId',mrf,'expectedVersion',saved->>'version','submissionId',saved->>'submissionId','decision','approve'))->'record';
  select id into archive from private.mrf_archive_snapshots where request_id=mrf;
  select id into job from private.document_jobs where resource_id=archive and kind='archive';
  part:=public.document_worker(job,'claim'); lease:=(part->>'lease')::uuid;
  perform public.document_worker(job,'checkpoint',lease,jsonb_build_object('formFileId','quote-fixture-form','supportingFileId','quote-fixture-support','formSha256',repeat('b',64),'supportingSha256',repeat('a',64),'formSize',20,'supportingSize',10,'verified',true));
  perform public.document_worker(job,'complete',lease);
  begin perform public.quotation_command(reader,command); raise exception 'Reader wrote quote'; exception when insufficient_privilege then null; end;
  begin perform public.quotations_read(site,mrf); raise exception 'Site read quotes'; exception when insufficient_privilege then null; end;
  result:=public.quotation_command(buyer,command); quote:=(result->>'quoteId')::uuid;
  if public.quotation_command(buyer,command)<>result then raise exception 'Create retry changed'; end if;
  if not exists(select 1 from private.mrf_downstream_references where request_id=mrf and record_id=quote) then raise exception 'First save omitted permanent reference'; end if;
  begin perform public.quotation_command(buyer,command||jsonb_build_object('requestId',gen_random_uuid())); raise exception 'Duplicate active draft accepted'; exception when unique_violation then null; end;
  if jsonb_array_length(public.quotations_read(reader,mrf)->'quotes')<>1 then raise exception 'Reader cannot read quote'; end if;
  part:=public.quotations_read(reader,mrf)->'request';
  if jsonb_typeof(part->'items') is distinct from 'array' or part->'items'->0->>'id' is distinct from form->'items'->0->>'id' then raise exception 'Quotation MRF projection contract failed'; end if;
  -- Current supplier status only gates first selection, not existing work.
  update private.suppliers set is_active=false where id=supplier;
  foreach k in array array['description','code','unit','quantity','unitPrice','brand','specification','conversionFactor','varianceReason','discountType','discountValue','taxLabel','taxRate','printedTotal','discrepancyNote','leadTime','notes','sourcePage'] loop line:=line||jsonb_build_object(k,''); end loop;
  line:=line||jsonb_build_object('id',gen_random_uuid(),'requestItemId',form->'items'->0->'id','sourceFileId',null,'description','Cement','unit','bag','quantity','0','unitPrice','12345678901234567890.12345678901234567890','conversionFactor','1');
  body:=body||jsonb_build_object('lines',jsonb_build_array(line),'printedTax','0','printedTotal','-123.4500');
  command:=jsonb_build_object('type','save','requestId',gen_random_uuid(),'quoteId',quote,'expectedVersion','1','body',body);
  result:=public.quotation_command(buyer,command); saved:=result->'quote';
  if saved->'body'->'lines'->0->>'unitPrice'<>line->>'unitPrice' or saved->'body'->>'printedTax'<>'0' or saved->'body'->>'currency'<>'' then raise exception 'Source strings changed'; end if;
  begin perform public.quotation_command(buyer,command||jsonb_build_object('requestId',gen_random_uuid())); raise exception 'Stale save accepted'; exception when serialization_failure then null; end;
  receipt:=public.quotation_command(buyer,command||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',saved->>'version'));
  if receipt->>'changed'<>'false' or receipt->'quote'->>'version'<>saved->>'version' then raise exception 'No-op save advanced version'; end if;
  begin perform public.quotation_command(buyer,jsonb_build_object('type','checkSource','requestId',gen_random_uuid(),'quoteId',quote,'expectedVersion',saved->>'version','expectedFiles','1')); raise exception 'Check without originals accepted'; exception when check_violation then null; end;
  -- A two-file group cannot replace current originals one file at a time.
  part:=public.quotation_files_command(buyer,jsonb_build_object('type','beginGroup','requestId',gen_random_uuid(),'quoteId',quote,'expectedFiles','1','keep','[]'::jsonb,'uploads',jsonb_build_array(
    jsonb_build_object('name','source.pdf','mime','application/pdf','size',10,'sha256',repeat('a',64)),jsonb_build_object('name','source.png','mime','image/png','size',10,'sha256',repeat('b',64)))));
  target_group:=(part->>'groupId')::uuid;
  for fid in select id from private.quotation_files where quotation_files.group_id=target_group order by id loop
    part:=public.quotation_transfer(buyer,fid,'claim'); lease:=(part->>'lease')::uuid;
    perform public.quotation_transfer(buyer,fid,'checkpoint',lease,jsonb_build_object('driveFileId','quote-original-'||fid));
    perform public.quotation_transfer(buyer,fid,'finish',lease);
    perform public.quotation_transfer(buyer,fid,'release',lease);
    select id into job from private.quotation_jobs where file_id=fid and kind='validate';
    part:=public.quotation_worker(job,'claim'); lease:=(part->>'lease')::uuid;
    begin perform public.quotation_worker(job,'complete',lease); raise exception 'Unverified worker completed'; exception when check_violation then null; end;
    if cardinality((select current_files from private.quotation_drafts where id=quote))<>0 then raise exception 'Partial group exposed'; end if;
    -- Ordinary logout removes the foreground session, not the durable job's authority.
    sid:=(buyer->>'sessionId')::uuid;
    delete from auth.sessions where id=sid;
    perform public.quotation_worker(job,'checkpoint',lease,'{"verified":true}');
    perform public.quotation_worker(job,'complete',lease);
    insert into auth.sessions(id,user_id,created_at,updated_at) values(sid,buyer_id,now(),now());
    proof:=private.login_preflight(buyer_id||'@example.invalid');
    perform private.bind_session(buyer_id,sid,proof->>'revision',proof->>'credential');
  end loop;
  saved:=private.quotation_view(quote);
  if jsonb_array_length(saved->'files')<>2 or saved->>'fileVersion'<>'2' or saved->>'version'<>result->'quote'->>'version' then raise exception 'Group commit changed text or lost files'; end if;
  retained_file:=(saved->'files'->0->>'id')::uuid;
  foreach reader_role in array array['Administrator','Project Manager','Accounting','Finance','Logistics'] loop
    delete from public.role_grants where user_id=reader_id;
    insert into public.role_grants values(reader_id,reader_role);
    sid:=(reader->>'sessionId')::uuid;
    delete from private.session_bindings where session_id=sid;
    proof:=private.login_preflight(reader_id||'@example.invalid');
    perform private.bind_session(reader_id,sid,proof->>'revision',proof->>'credential');
    reader:=reader||jsonb_build_object('revision',proof->>'revision','activeRole',reader_role);
    perform public.quotation_file(reader,retained_file);
    if jsonb_array_length(public.quotations_read(reader,mrf)->'quotes')<>1 then raise exception 'Non-Site reader lost quotation'; end if;
    begin perform public.quotation_command(reader,command); raise exception 'Non-Procurement writer admitted'; exception when insufficient_privilege then null; end;
  end loop;
  command:=jsonb_build_object('type','confirmMatch','requestId',gen_random_uuid(),'quoteId',quote,'expectedVersion',saved->>'version','expectedFiles',saved->>'fileVersion','lineId',line->>'id');
  saved:=public.quotation_command(buyer,command)->'quote';
  saved:=public.quotation_command(buyer,jsonb_build_object('type','checkSource','requestId',gen_random_uuid(),'quoteId',quote,'expectedVersion',saved->>'version','expectedFiles',saved->>'fileVersion'))->'quote';
  if saved->>'checked'<>'true' or jsonb_array_length(saved->'matches')<>1 then raise exception 'Source review not bound'; end if;
  body:=body||'{"notes":"Header edit"}';
  saved:=public.quotation_command(buyer,jsonb_build_object('type','save','requestId',gen_random_uuid(),'quoteId',quote,'expectedVersion',saved->>'version','body',body))->'quote';
  if saved->>'checked'='true' or jsonb_array_length(saved->'matches')<>1 then raise exception 'Header edit stamps wrong'; end if;
  body:=jsonb_set(body,'{lines,0,quantity}','"1"');
  saved:=public.quotation_command(buyer,jsonb_build_object('type','save','requestId',gen_random_uuid(),'quoteId',quote,'expectedVersion',saved->>'version','body',body))->'quote';
  if jsonb_array_length(saved->'matches')<>0 then raise exception 'Changed line kept match'; end if;
  v:=saved->>'version'; fv:=saved->>'fileVersion';
  perform public.quotation_files_command(buyer,jsonb_build_object('type','beginGroup','requestId',gen_random_uuid(),'quoteId',quote,'expectedFiles',fv,'keep',jsonb_build_array(retained_file),'uploads','[]'::jsonb));
  saved:=private.quotation_view(quote);
  if saved->>'version'<>v or saved->>'fileVersion'=fv or jsonb_array_length(saved->'files')<>1 then raise exception 'Independent file version broken'; end if;
  perform public.quotation_file(reader,retained_file);
  saved:=public.quotation_command(buyer,jsonb_build_object('type','status','requestId',gen_random_uuid(),'quoteId',quote,'expectedVersion',saved->>'version','state','cancelled','reason','Supplier withdrawn'))->'quote';
  perform public.quotation_file(reader,retained_file);
  if jsonb_array_length(saved->'files')<>1 then raise exception 'Cancellation discarded current originals'; end if;
  begin perform public.quotation_command(buyer,jsonb_build_object('type','create','requestId',gen_random_uuid(),'mrfId',mrf,'supplierId',supplier,'body',body)); raise exception 'Inactive supplier selected'; exception when check_violation then null; end;
  update private.suppliers set is_active=true where id=supplier;
  other_quote:=(public.quotation_command(buyer,jsonb_build_object('type','create','requestId',gen_random_uuid(),'mrfId',mrf,'supplierId',supplier,'body',body))->>'quoteId')::uuid;
  begin perform public.quotation_command(buyer,jsonb_build_object('type','status','requestId',gen_random_uuid(),'quoteId',quote,'expectedVersion',saved->>'version','state','draft','reason','Resume original offer')); raise exception 'Reopened duplicate active draft'; exception when unique_violation then null; end;
  saved:=public.request_command(buyer,jsonb_build_object('type','openCorrection','requestId',gen_random_uuid(),'mrfId',mrf,'expectedVersion',private.request_snapshot(mrf)->>'version','reason','Correct supporting original'))->'record';
  if saved->>'correctionKind'<>'documents' then raise exception 'Cancellation erased permanent downstream restriction'; end if;
  begin perform public.quotation_command(buyer,jsonb_build_object('type','save','requestId',gen_random_uuid(),'quoteId',other_quote,'expectedVersion','1','body',body)); raise exception 'Correction allowed quotation write'; exception when sqlstate 'P4502' then null; end;
  update public.profiles set access_revision=access_revision+1 where user_id=buyer_id;
  begin perform public.quotations_read(buyer,mrf); raise exception 'Revoked actor read quotes'; exception when insufficient_privilege then null; end;
  -- Service-only RPCs and private rows are never callable by browser database roles.
  if has_function_privilege('authenticated','public.quotation_command(jsonb,jsonb)','execute') or has_table_privilege('service_role','private.quotation_files','select') then raise exception 'Quotation boundary exposed'; end if;
end $$;
rollback;
