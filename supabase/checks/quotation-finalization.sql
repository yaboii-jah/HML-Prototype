-- Rollback-only lifecycle/security checks. Real bytes and calculations are exercised
-- through the application/Workflow browser acceptance, not manufactured here.
begin;
set local statement_timeout='90s';

create function pg_temp.quotation_test_action(actor jsonb,target uuid,kind text,extra jsonb default '{}',calculation jsonb default null) returns jsonb language plpgsql as $$
declare q jsonb:=private.quotation_view(target); command jsonb;
begin
  command:=jsonb_build_object('type',kind,'requestId',gen_random_uuid(),'quoteId',target,'expectedVersion',q->>'version','expectedFiles',q->>'fileVersion',
    'expectedFamily',q->'family'->>'version','expectedFinancial',q->'financial'->>'version')||extra;
  if kind in('save','status','checkSource','confirmMatch') then return public.quotation_command(actor,command); end if;
  return public.quotation_financial_command(actor,command,calculation);
end $$;

do $$
#variable_conflict use_variable
declare project uuid:=gen_random_uuid(); scope uuid:=gen_random_uuid(); site_id uuid:=gen_random_uuid(); manager_id uuid:=gen_random_uuid(); buyer_id uuid:=gen_random_uuid(); reader_id uuid:=gen_random_uuid();
  uid uuid; sid uuid; proof jsonb; actors jsonb:='{}'; site jsonb; manager jsonb; buyer jsonb; reader jsonb; role_name text;
  mrf uuid; supplier uuid; mapping uuid:=gen_random_uuid(); document uuid:=gen_random_uuid(); mrf_archive uuid; job uuid; lease uuid; file uuid; group_id uuid;
  quote uuid; replacement uuid; revision uuid; replacement_revision uuid; item_id uuid:=gen_random_uuid(); line_id uuid:=gen_random_uuid();
  form jsonb; body jsonb:='{}'; line jsonb:='{}'; saved jsonb; part jsonb; review jsonb; calculation jsonb; k text; command jsonb; result jsonb; frozen jsonb; current_mrf uuid;
begin
  insert into public.projects(id,name,location,document_code) values(project,'Finalization fixture '||project,'Site','FN-'||upper(substr(project::text,1,8)));
  insert into public.project_budgets values(project,1000);
  insert into public.scopes(id,project_id,name) values(scope,project,'Structural Works');
  insert into public.scope_budgets values(scope,1000);
  for uid in select unnest(array[site_id,manager_id,buyer_id,reader_id]) loop
    role_name:=case uid when site_id then 'Site Personnel' when manager_id then 'Project Manager' when buyer_id then 'Procurement' else 'Accounting' end;
    sid:=gen_random_uuid();
    insert into auth.users(id,email,is_anonymous,email_confirmed_at,encrypted_password) values(uid,uid||'@example.invalid',false,now(),'fixture');
    insert into public.profiles(user_id,display_name,is_active) values(uid,'Finalization fixture',true);
    insert into public.role_grants values(uid,role_name);
    if uid=site_id then insert into public.project_assignments values(uid,project); end if;
    insert into auth.sessions(id,user_id,created_at,updated_at) values(sid,uid,now(),now());
    proof:=private.login_preflight(uid||'@example.invalid'); perform private.bind_session(uid,sid,proof->>'revision',proof->>'credential');
    actors:=actors||jsonb_build_object(uid::text,jsonb_build_object('userId',uid,'sessionId',sid,'revision',proof->>'revision','activeRole',role_name));
  end loop;
  site:=actors->site_id::text; manager:=actors->manager_id::text; buyer:=actors->buyer_id::text; reader:=actors->reader_id::text;
  form:=jsonb_build_object('scopeId',scope,'requestDate','2026-11-05','sourceRef','','requestedBy','Site','approvedBy','PM','purchaser','Buyer','financeOfficer','Finance','specialInstructions','',
    'items',jsonb_build_array(jsonb_build_object('id',item_id,'name','Cement','unit','bag','quantity','10','neededDate','2026-11-05','purpose','','location','Site','remarks','')));
  saved:=public.request_command(site,jsonb_build_object('type','createDraft','requestId',gen_random_uuid(),'projectId',project,'draft',form))->'record'; mrf:=(saved->>'id')::uuid;
  insert into private.project_document_folders(id,project_id,folder_id,root_id,name) values(mapping,project,'finalization-folder-'||project,'fixture-root','Fixture');
  insert into private.request_documents(id,request_id,folder_mapping_id,drive_file_id,name,size,sha256,uploader_id,uploader_name)
    values(document,mrf,mapping,'finalization-support-'||document,'support.pdf',10,repeat('a',64),site_id,'Original uploader');
  insert into private.request_document_state values(mrf,2,document);
  saved:=public.request_command(site,jsonb_build_object('type','submitMrf','requestId',gen_random_uuid(),'mrfId',mrf,'expectedVersion',saved->>'version','draft',form,'attachmentRevision','2'))->'record';
  saved:=public.request_command(manager,jsonb_build_object('type','reviewMrf','requestId',gen_random_uuid(),'mrfId',mrf,'expectedVersion',saved->>'version','submissionId',saved->>'submissionId','decision','approve'))->'record';
  select id into mrf_archive from private.mrf_archive_snapshots where request_id=mrf;
  select id into job from private.document_jobs where resource_id=mrf_archive and kind='archive';
  part:=public.document_worker(job,'claim'); lease:=(part->>'lease')::uuid;
  perform public.document_worker(job,'checkpoint',lease,jsonb_build_object('formFileId','finalization-mrf','supportingFileId','finalization-support','formSha256',repeat('b',64),'supportingSha256',repeat('a',64),'formSize',20,'supportingSize',10,'verified',true));
  perform public.document_worker(job,'complete',lease);
  supplier:=(public.supplier_command(buyer,jsonb_build_object('type','createSupplier','requestId',gen_random_uuid(),'profile',jsonb_build_object('name','Finalization supplier '||project,'address','','tin','','contactName','','email','','phone','','accreditationNote','')))->>'supplierId')::uuid;
  foreach k in array array['supplierName','address','tin','contactName','email','phone','ref','date','validUntil','currency','paymentTerms','deliveryTerms','availability','leadDays','notes','taxStatus','priceBasis','financialNotes','vatRate','printedSubtotal','printedTax','printedTotal'] loop body:=body||jsonb_build_object(k,''); end loop;
  foreach k in array array['description','code','unit','quantity','unitPrice','brand','specification','conversionFactor','varianceReason','discountType','discountValue','taxLabel','taxRate','printedTotal','discrepancyNote','leadTime','notes','sourcePage'] loop line:=line||jsonb_build_object(k,''); end loop;
  line:=line||jsonb_build_object('id',line_id,'requestItemId',item_id,'sourceFileId',null,'description','Cement','unit','bag','quantity','1','unitPrice','112','conversionFactor','1');
  body:=body||jsonb_build_object('ref','FN-1','date','2026-11-05','paymentTerms','30 days','deliveryTerms','Delivered','vatRate','12','lines',jsonb_build_array(line),'adjustments','[]'::jsonb);
  quote:=(public.quotation_command(buyer,jsonb_build_object('type','create','requestId',gen_random_uuid(),'mrfId',mrf,'supplierId',supplier,'body',body))->>'quoteId')::uuid;
  part:=public.quotation_files_command(buyer,jsonb_build_object('type','beginGroup','requestId',gen_random_uuid(),'quoteId',quote,'expectedFiles','1','keep','[]'::jsonb,
    'uploads',jsonb_build_array(jsonb_build_object('name','original.pdf','mime','application/pdf','size',10,'sha256',repeat('a',64)))));
  group_id:=(part->>'groupId')::uuid;
  select id into file from private.quotation_files where quotation_files.group_id=group_id;
  part:=public.quotation_transfer(buyer,file,'claim'); lease:=(part->>'lease')::uuid;
  perform public.quotation_transfer(buyer,file,'checkpoint',lease,jsonb_build_object('driveFileId','finalization-original-'||file));
  perform public.quotation_transfer(buyer,file,'finish',lease);
  select id into job from private.quotation_jobs where file_id=file and kind='validate';
  part:=public.quotation_worker(job,'claim'); lease:=(part->>'lease')::uuid;
  perform public.quotation_worker(job,'checkpoint',lease,'{"verified":true}'); perform public.quotation_worker(job,'complete',lease);
  perform pg_temp.quotation_test_action(buyer,quote,'confirmMatch',jsonb_build_object('lineId',line_id));
  perform pg_temp.quotation_test_action(buyer,quote,'checkSource');
  review:=jsonb_build_object('vatStatus','VAT','priceBasis','inclusive','vatRate','12','subtotalBasis','materials','totalBasis','gross',
    'rows',jsonb_build_array(jsonb_build_object('id',line_id,'role','material','discountType','none','taxable',null,'free',false,'reason','','printedBasis','input','summaryBasis','','amountField','printedTotal')),'adjustments','[]'::jsonb);
  calculation:=jsonb_build_object('ruleVersion','hml-quotation-2026-11-05-v1','materials','112.00','subtotal','112.00','vat','12.00','gross','112.00','ewtGoods','1.00','ewtServices','0.00','net','111.00',
    'rows',jsonb_build_array(jsonb_build_object('id',line_id,'label','Cement','role','material','input','112.00','contribution','112.00','taxable',true,'excluded',false,'reason','')),
    'adjustments','[]'::jsonb,'comparisons','[]'::jsonb,'issues','[]'::jsonb);
  begin perform pg_temp.quotation_test_action(reader,quote,'saveFinancial',jsonb_build_object('review',review),calculation); raise exception 'Reader wrote finances'; exception when insufficient_privilege then null; end;
  perform pg_temp.quotation_test_action(buyer,quote,'saveFinancial',jsonb_build_object('review',review),calculation);
  saved:=private.quotation_view(quote);
  result:=pg_temp.quotation_test_action(buyer,quote,'saveFinancial',jsonb_build_object('review',review),calculation);
  if result->>'changed'<>'false' or result->'quote'->'financial'->>'version'<>saved->'financial'->>'version' then raise exception 'Financial no-op changed versions'; end if;
  begin perform pg_temp.quotation_test_action(buyer,quote,'finalize','{}',calculation); raise exception 'Unchecked finances finalized'; exception when sqlstate 'P4504' then null; end;
  perform pg_temp.quotation_test_action(buyer,quote,'checkFinancial');
  update private.suppliers set is_active=false where id=supplier;
  begin perform pg_temp.quotation_test_action(buyer,quote,'finalize','{}',calculation); raise exception 'Inactive offer finalized'; exception when sqlstate 'P4504' then null; end;
  update private.suppliers set is_active=true where id=supplier;
  saved:=private.quotation_view(quote);
  command:=jsonb_build_object('type','finalize','requestId',gen_random_uuid(),'quoteId',quote,'expectedVersion',saved->>'version','expectedFiles',saved->>'fileVersion','expectedFinancial',saved->'financial'->>'version','expectedFamily',saved->'family'->>'version');
  result:=public.quotation_financial_command(buyer,command,calculation);
  if public.quotation_financial_command(buyer,command,calculation)<>result then raise exception 'Finalize retry changed outcome'; end if;
  revision:=(result->'quote'->'revision'->>'id')::uuid;
  if result->'quote'->'revision'->>'eligible' is distinct from 'false' or result->'quote'->'revision'->>'current' is distinct from 'false' then raise exception 'Pending archive became eligible or omitted its boolean state'; end if;
  -- Revert this alternate branch after proving that withdrawing the first pending
  -- offer cannot bypass the reasoned revision action through ordinary create.
  begin
    perform pg_temp.quotation_test_action(buyer,quote,'withdraw',jsonb_build_object('reason','Supplier withdrew before archive completion'));
    begin
      perform public.quotation_command(buyer,jsonb_build_object('type','create','requestId',gen_random_uuid(),'mrfId',mrf,'supplierId',supplier,'body',body));
      raise exception 'Finalized family accepted an unreasoned new offer';
    exception when unique_violation then null; end;
    raise exception 'Revert alternate withdrawal fixture' using errcode='P9999';
  exception when sqlstate 'P9999' then null; end;
  select snapshot into frozen from private.quotation_revisions where id=revision;
  begin update private.quotation_revisions set snapshot='{}' where id=revision; raise exception 'Snapshot changed'; exception when check_violation then null; end;
  begin update private.quotation_drafts set body='{}' where id=quote; raise exception 'Finalized source changed'; exception when check_violation then null; end;
  begin update private.quotation_financial_reviews set review='{}' where quote_id=quote; raise exception 'Finalized finance changed'; exception when check_violation then null; end;
  begin update private.quotation_files set retained=false where id=file; raise exception 'Finalized file released'; exception when check_violation then null; end;
  perform private.quotation_enqueue(file,'cleanup',private.document_actor_snapshot(buyer));
  select id into job from private.quotation_jobs where file_id=file and kind='cleanup';
  if public.quotation_worker(job,'claim') is not null or (select state from private.quotation_files where id=file)<>'verified' then raise exception 'Protected original cleanup admitted'; end if;
  select id into job from private.quotation_archive_jobs where revision_id=revision;
  part:=public.quotation_archive_worker(job,'claim'); lease:=(part->>'lease')::uuid;
  begin perform public.quotation_archive_worker(job,'complete',lease); raise exception 'Archive completed without proof'; exception when check_violation then null; end;
  perform public.quotation_archive_worker(job,'checkpoint',lease,jsonb_build_object('pdfFileId','review-'||revision,'pdfSha256',repeat('c',64),'pdfSize',100,'manifest',jsonb_build_array(jsonb_build_object('id',file,'size',10,'sha256',repeat('a',64))),'verified',true));
  perform public.quotation_archive_worker(job,'complete',lease);
  saved:=private.quotation_view(quote);
  if saved->'revision'->>'eligible'<>'true' or saved->'family'->'pendingQuoteId'<>'null'::jsonb then raise exception 'Verified archive failed activation'; end if;
  perform public.quotation_review_pdf(reader,revision);
  begin perform public.quotation_review_pdf(site,revision); raise exception 'Site read review PDF'; exception when insufficient_privilege then null; end;
  -- Current MRF corrections pause reuse and require a separate, exact new attestation.
  saved:=public.request_command(buyer,jsonb_build_object('type','openCorrection','requestId',gen_random_uuid(),'mrfId',mrf,'expectedVersion',private.request_snapshot(mrf)->>'version','reason','Review updated supporting plans'))->'record';
  if private.quotation_view(quote)->'revision'->>'eligible'<>'false' then raise exception 'Open MRF correction kept quote eligible'; end if;
  saved:=public.request_command(site,jsonb_build_object('type','submitMrf','requestId',gen_random_uuid(),'mrfId',mrf,'expectedVersion',saved->>'version','draft',form,'attachmentRevision','2'))->'record';
  saved:=public.request_command(manager,jsonb_build_object('type','reviewMrf','requestId',gen_random_uuid(),'mrfId',mrf,'expectedVersion',saved->>'version','submissionId',saved->>'submissionId','decision','approve'))->'record';
  select id into current_mrf from private.mrf_archive_snapshots where request_id=mrf order by version desc limit 1;
  select id into job from private.document_jobs where resource_id=current_mrf and kind='archive';
  part:=public.document_worker(job,'claim'); lease:=(part->>'lease')::uuid;
  perform public.document_worker(job,'checkpoint',lease,jsonb_build_object('formFileId','corrected-finalization-mrf','supportingFileId','corrected-finalization-support','formSha256',repeat('b',64),'supportingSha256',repeat('a',64),'formSize',20,'supportingSize',10,'verified',true)); perform public.document_worker(job,'complete',lease);
  if private.quotation_view(quote)->'revision'->>'eligible'<>'false' then raise exception 'Corrected MRF auto-reconfirmed quote'; end if;
  begin perform pg_temp.quotation_test_action(buyer,quote,'reconfirmMrf',jsonb_build_object('expectedMrf',mrf_archive,'reason','Offer still applicable')); raise exception 'Stale MRF confirmed'; exception when serialization_failure then null; end;
  perform pg_temp.quotation_test_action(buyer,quote,'reconfirmMrf',jsonb_build_object('expectedMrf',current_mrf,'reason','Offer still applies to reviewed plans'));
  if private.quotation_view(quote)->'revision'->>'eligible'<>'true' or (select snapshot from private.quotation_revisions where id=revision)<>frozen then raise exception 'Reconfirmation changed financial snapshot or failed eligibility'; end if;
  -- A replacement reuses same-family retained bytes, while every attestation clears.
  replacement:=(pg_temp.quotation_test_action(buyer,quote,'startRevision',jsonb_build_object('reason','Correct captured supplier notes'))->>'quoteId')::uuid;
  saved:=private.quotation_view(replacement);
  if saved->>'checked'='true' or saved->'financial'->>'checked'='true' or saved->'matches'<>'[]'::jsonb or jsonb_array_length(saved->'files')<>1 then raise exception 'Copied revision inherited review or lost source'; end if;
  if private.quotation_view(quote)->'revision'->>'eligible'<>'true' then raise exception 'Draft replacement displaced prior offer'; end if;
  begin perform pg_temp.quotation_test_action(buyer,quote,'startRevision',jsonb_build_object('reason','Duplicate replacement')); raise exception 'Parallel replacement admitted'; exception when sqlstate 'P4504' then null; end;
  perform public.quotation_files_command(buyer,jsonb_build_object('type','beginGroup','requestId',gen_random_uuid(),'quoteId',replacement,'expectedFiles',saved->>'fileVersion','keep',jsonb_build_array(file),'uploads','[]'::jsonb));
  perform pg_temp.quotation_test_action(buyer,replacement,'confirmMatch',jsonb_build_object('lineId',line_id)); perform pg_temp.quotation_test_action(buyer,replacement,'checkSource'); perform pg_temp.quotation_test_action(buyer,replacement,'checkFinancial');
  saved:=pg_temp.quotation_test_action(buyer,replacement,'finalize','{}',calculation)->'quote'; replacement_revision:=(saved->'revision'->>'id')::uuid;
  if saved->'revision'->>'number'<>'2' then raise exception 'Revision numbering changed'; end if;
  perform pg_temp.quotation_test_action(buyer,replacement,'withdraw',jsonb_build_object('reason','Supplier withdrew replacement offer'));
  select id into job from private.quotation_archive_jobs where revision_id=replacement_revision;
  part:=public.quotation_archive_worker(job,'claim'); lease:=(part->>'lease')::uuid;
  perform public.quotation_archive_worker(job,'checkpoint',lease,jsonb_build_object('pdfFileId','review-'||replacement_revision,'pdfSha256',repeat('d',64),'pdfSize',100,'manifest',jsonb_build_array(jsonb_build_object('id',file,'size',10,'sha256',repeat('a',64))),'verified',true)); perform public.quotation_archive_worker(job,'complete',lease);
  if private.quotation_view(replacement)->'revision'->>'eligible'<>'false' or private.quotation_view(quote)->'revision'->>'eligible'<>'true' then raise exception 'Late withdrawn archive displaced current offer'; end if;
  perform pg_temp.quotation_test_action(buyer,quote,'withdraw',jsonb_build_object('reason','Supplier withdrew original offer'));
  if private.quotation_view(quote)->'revision'->>'eligible'<>'false' then raise exception 'Withdrawn original stayed eligible'; end if;
  begin perform pg_temp.quotation_test_action(buyer,quote,'activateRevision',jsonb_build_object('expectedMrf',current_mrf,'reason','Attempt to restore old offer')); raise exception 'Withdrawal restored'; exception when sqlstate 'P4504' then null; end;
  if has_function_privilege('authenticated','public.quotation_financial_command(jsonb,jsonb,jsonb)','execute')
    or has_function_privilege('anon','public.quotation_archive_worker(uuid,text,uuid,jsonb)','execute')
    or has_table_privilege('authenticated','private.quotation_revisions','select') then raise exception 'Finalization permissions exposed'; end if;
end $$;
rollback;
