-- Rollback-only synthetic owning transactions. No provider/archive behavior is
-- asserted by these deliberately direct approved-record fixtures.
begin;
set local statement_timeout='60s';
create function pg_temp.demand_fixture() returns jsonb language plpgsql as $$
declare person uuid:=gen_random_uuid(); session uuid:=gen_random_uuid(); project uuid:=gen_random_uuid();
  request uuid:=gen_random_uuid(); item uuid:=gen_random_uuid(); other_item uuid:=gen_random_uuid();
  archive uuid:=gen_random_uuid(); document uuid:=gen_random_uuid(); mapping uuid:=gen_random_uuid(); proof jsonb; form jsonb;
begin
  insert into auth.users(id,email,is_anonymous,email_confirmed_at,encrypted_password) values(person,person||'@example.invalid',false,now(),'fixture');
  insert into public.profiles(user_id,display_name,is_active) values(person,'Demand fixture',true);
  insert into public.role_grants values(person,'Procurement');
  insert into auth.sessions(id,user_id,created_at,updated_at) values(session,person,now(),now());
  proof:=private.login_preflight(person||'@example.invalid');
  perform private.bind_session(person,session,proof->>'revision',proof->>'credential');
  insert into public.projects(id,name,document_code) values(project,'Demand fixture '||project,'DM-'||upper(substr(project::text,1,8)));
  form:=jsonb_build_object('items',jsonb_build_array(
    jsonb_build_object('id',item,'quantity','18','unit','bag'),jsonb_build_object('id',other_item,'quantity','0.3','unit','m')));
  insert into public.material_requests(id,project_id,ref,sequence,data,creator_id,creator_name,updater_id,updater_name,status)
    values(request,project,'DM-'||request||'-MRF-0001',1,'{}',person,'Demand fixture',person,'Demand fixture','approved');
  insert into public.material_request_items(id,request_id,position,data)
    values(item,request,0,form->'items'->0),(other_item,request,1,form->'items'->1);
  insert into private.project_document_folders(id,project_id,folder_id,root_id,name) values(mapping,project,'demand-'||mapping,'fixture-root','Fixture');
  insert into private.request_documents(id,request_id,folder_mapping_id,drive_file_id,name,size,sha256,uploader_id,uploader_name)
    values(document,request,mapping,'demand-'||document,'fixture.pdf',10,repeat('a',64),person,'Demand fixture');
  insert into private.mrf_archive_snapshots(id,request_id,version,source_document,request_version,attachment_revision,snapshot,approved_by,approved_name,approved_at)
    values(archive,request,1,document,1,1,jsonb_build_object('draft',form),person,'Demand fixture',now());
  insert into private.document_jobs(kind,project_id,request_id,resource_id,actor,original_actor,state,checkpoint)
    values('archive',project,request,archive,'{}','{}','complete','{"formSize":10,"supportingSize":10}');
  insert into private.mrf_archives(snapshot_id,folder_mapping_id,form_file_id,form_sha256,supporting_file_id,supporting_sha256)
    values(archive,mapping,'demand-form-'||archive,repeat('a',64),'demand-support-'||archive,repeat('a',64));
  return jsonb_build_object('actor',jsonb_build_object('userId',person,'sessionId',session,'revision',proof->>'revision','activeRole','Procurement'),
    'request',request,'item',item,'otherItem',other_item,'archive',archive);
end $$;

-- Owning purchasing security/atomicity fixtures. Archive metadata below is synthetic;
-- real bytes and Workflow integrity belong to the separate application acceptance.
create function pg_temp.purchasing_fixture() returns jsonb language plpgsql as $$
declare f jsonb:=pg_temp.demand_fixture(); target uuid:=(f->>'request')::uuid; caller uuid:=(f->'actor'->>'userId')::uuid;
  supplier uuid:=gen_random_uuid(); quote uuid:=gen_random_uuid(); revision uuid:=gen_random_uuid(); line uuid:=gen_random_uuid();
  family uuid; body jsonb:='{}'; source jsonb:='{}'; review jsonb; calculation jsonb; k text; fields jsonb:='{}'; orderline uuid:=gen_random_uuid();
begin
  supplier:=(public.supplier_command(f->'actor',jsonb_build_object('type','createSupplier','requestId',gen_random_uuid(),'profile',jsonb_build_object('name','Purchasing supplier '||supplier,'address','','tin','','contactName','','email','','phone','','accreditationNote','')))->>'supplierId')::uuid;
  foreach k in array array['supplierName','address','tin','contactName','email','phone','ref','date','validUntil','currency','paymentTerms','deliveryTerms','availability','leadDays','notes','taxStatus','priceBasis','financialNotes','vatRate','printedSubtotal','printedTax','printedTotal'] loop body:=body||jsonb_build_object(k,''); end loop;
  foreach k in array array['description','code','unit','quantity','unitPrice','brand','specification','conversionFactor','varianceReason','discountType','discountValue','taxLabel','taxRate','printedTotal','discrepancyNote','leadTime','notes','sourcePage'] loop source:=source||jsonb_build_object(k,''); end loop;
  source:=source||jsonb_build_object('id',line,'requestItemId',f->>'item','sourceFileId',null,'description','Cement','unit','bag','quantity','10','unitPrice','112','conversionFactor','1');
  body:=body||jsonb_build_object('supplierName','Purchasing supplier','ref','PUR-1','date','2026-11-06','paymentTerms','30 days','deliveryTerms','Delivered','lines',jsonb_build_array(source),'adjustments','[]'::jsonb);
  insert into private.quotation_drafts(id,request_id,supplier_id,body,state,creator_id,creator_name,matches)
    values(quote,target,supplier,body,'finalized',caller,'Purchasing fixture',jsonb_build_object(line::text,jsonb_build_object('line',source,'fileVersion','1')));
  select family_id into family from private.quotation_drafts where id=quote;
  review:=jsonb_build_object('vatStatus','VAT','priceBasis','inclusive','vatRate','12','subtotalBasis','materials','totalBasis','gross','rows',jsonb_build_array(jsonb_build_object('id',line,'role','material','discountType','none','taxable',null,'free',false,'reason','','printedBasis','input','summaryBasis','','amountField','printedTotal')),'adjustments','[]'::jsonb);
  calculation:=jsonb_build_object('ruleVersion','hml-quotation-2026-11-05-v1','materials','1120.00','subtotal','1120.00','vat','120.00','gross','1120.00','ewtGoods','10.00','ewtServices','0.00','net','1110.00','rows','[]'::jsonb,'adjustments','[]'::jsonb,'comparisons','[]'::jsonb,'issues','[]'::jsonb);
  insert into private.quotation_revisions(id,family_id,quote_id,number,mrf_archive_id,source_version,file_version,financial_version,snapshot,finalized_by,finalized_name)
    values(revision,family,quote,1,(f->>'archive')::uuid,1,1,1,jsonb_build_object('source',body,'review',review,'calculation',calculation,'matches',jsonb_build_object(line::text,jsonb_build_object('line',source,'fileVersion','1'))),caller,'Purchasing fixture');
  insert into private.quotation_archives(revision_id,folder_mapping_id,file_id,sha256,size,manifest)
    select revision,d.id,'synthetic-purchasing-review',repeat('a',64),10,'[]' from private.project_document_folders d join public.material_requests r on r.project_id=d.project_id where r.id=target and d.current;
  update private.quotation_families set current_quote_id=quote,pending_quote_id=null where id=family;
  foreach k in array array['date','vendorName','vendorAddress','vendorContact','vendorPhone','shipTo','shipAddress','shipContact','shipPhone','requisitioner','paymentTerms','fob','shippingTerms','bankName','accountName','accountNumber','notes'] loop fields:=fields||jsonb_build_object(k,''); end loop;
  fields:=fields||'{"date":"2026-11-06","vendorName":"Purchasing supplier","shipTo":"Site","requisitioner":"Site","paymentTerms":"30 days","shippingTerms":"Delivered"}';
  return f||jsonb_build_object('quote',quote,'family',family,'revision',revision,'supplier',supplier,'sourceLine',line,
    'body',jsonb_build_object('reason','Reviewed supplier award','fields',fields,'adjustments','[]'::jsonb,'lines',jsonb_build_array(jsonb_build_object('id',orderline,'sourceLineId',line,'itemId',f->>'item','offeredQuantity','6','quantity','6','fixedDiscount','','discountReason','','discountConfirmed',false))));
end $$;
create function pg_temp.purchasing_action(f jsonb,kind text,target uuid,extra jsonb default '{}',calculation jsonb default null) returns jsonb language plpgsql as $$
declare parent uuid:=(f->>'request')::uuid; command jsonb;
begin
  command:=jsonb_build_object('type',kind,'requestId',gen_random_uuid(),'mrfId',parent,'targetId',target,'expectedVersion',coalesce((select version::text from private.purchasing_heads where request_id=parent),'0'),
    'expectedDemand',private.demand_snapshot(parent)->>'version','quoteId',f->>'quote','expectedFamily',(select version::text from private.quotation_families where id=(f->>'family')::uuid),'body',f->'body')||extra;
  return public.purchasing_command(f->'actor',command,calculation);
end $$;

-- Assertions (the concurrency runner reuses only the fixture definitions).
do $$
declare f jsonb:=pg_temp.purchasing_fixture(); award uuid:=gen_random_uuid(); po uuid; saved jsonb; result jsonb; command jsonb;
  body jsonb; demand jsonb; previous jsonb; counter bigint; audit_count bigint; uid uuid:=(f->'actor'->>'userId')::uuid; excess jsonb; other jsonb;
begin
  if private.quotation_revision_blockers((f->>'revision')::uuid)<>'[]'::jsonb then raise exception 'Synthetic source is not eligible'; end if;
  command:=jsonb_build_object('type','saveAward','requestId',gen_random_uuid(),'mrfId',f->>'request','targetId',award,'expectedVersion','0','expectedDemand','0','quoteId',f->>'quote','expectedFamily',(select version::text from private.quotation_families where id=(f->>'family')::uuid),'body',f->'body');
  result:=public.purchasing_command(f->'actor',command);
  if public.purchasing_command(f->'actor',command)<>result then raise exception 'Award retry changed outcome'; end if;
  if (select count(*) from private.purchasing_records where id=award)<>1 or (select count(*) from private.audit_events where request_id=(command->>'requestId')::uuid)<>1 then raise exception 'Award retry duplicated effects'; end if;
  demand:=private.demand_snapshot((f->>'request')::uuid);
  if demand->'requirements'->0->>'awarded'<>'6' then raise exception 'Saved award did not claim demand'; end if;
  result:=pg_temp.purchasing_action(f,'saveAward',award);
  if result->>'changed'<>'false' then raise exception 'Unchanged award wrote history'; end if;
  body:=jsonb_set(f->'body','{lines,0,offeredQuantity}','"11"'); body:=jsonb_set(body,'{lines,0,quantity}','"11"');
  begin perform pg_temp.purchasing_action(f,'saveAward',award,jsonb_build_object('body',body)); raise exception 'Supplier capacity exceeded'; exception when check_violation then null; end;
  previous:=private.demand_snapshot((f->>'request')::uuid);
  begin
    result:=pg_temp.purchasing_action(f,'convert',award); po:=(result->>'targetId')::uuid;
    raise exception 'Rollback conversion fixture' using errcode='P9999';
  exception when sqlstate 'P9999' then null; end;
  if private.demand_snapshot((f->>'request')::uuid)<>previous or exists(select 1 from private.purchasing_records where kind='po' and request_id=(f->>'request')::uuid) then raise exception 'Failed conversion persisted effects'; end if;
  result:=pg_temp.purchasing_action(f,'convert',award); po:=(result->>'targetId')::uuid;
  demand:=private.demand_snapshot((f->>'request')::uuid);
  if demand->'requirements'->0->>'awarded'<>'0' or demand->'requirements'->0->>'ordered'<>'6' then raise exception 'Conversion freed or duplicated demand'; end if;
  if not exists(select 1 from private.po_preparers where po_id=po and actor_id=uid) then raise exception 'Permanent PO preparer missing'; end if;
  if (select ref from private.purchasing_records where id=po) !~ '-PO-0001$' then raise exception 'PO numbering changed'; end if;
  begin perform pg_temp.purchasing_action(f,'saveAward',gen_random_uuid()); raise exception 'Parallel supplier queue admitted'; exception when unique_violation then null; end;
  begin perform pg_temp.purchasing_action(f,'reopen',award,'{"reason":"Reopen converted award"}'); raise exception 'Converted award reopened'; exception when sqlstate 'P4802' then null; end;
  saved:=private.purchasing_record_view(po); counter:=(saved->>'version')::bigint;
  result:=pg_temp.purchasing_action(f,'savePo',po,jsonb_build_object('body',saved->'body'));
  if result->>'changed'<>'false' or (select version from private.purchasing_records where id=po)<>counter then raise exception 'No-op PO changed'; end if;
  -- Source loss retains claims and permits explicit reductions, never increases.
  update private.suppliers set is_active=false where id=(f->>'supplier')::uuid;
  if not exists(select 1 from private.demand_claims where owner_id=po and quantity=6) then raise exception 'Inactivity released claims'; end if;
  body:=jsonb_set(saved->'body','{lines,0,quantity}','"4"'); body:=jsonb_set(body,'{lines,0,offeredQuantity}','"4"');
  perform pg_temp.purchasing_action(f,'savePo',po,jsonb_build_object('body',body));
  begin perform pg_temp.purchasing_action(f,'savePo',po,jsonb_build_object('body',saved->'body')); raise exception 'Blocked increase admitted'; exception when sqlstate 'P4802' then null; end;
  perform pg_temp.purchasing_action(f,'cancel',po,'{"reason":"Cancel retained draft demand"}');
  if exists(select 1 from private.demand_claims where owner_id=po and quantity>0) or exists(select 1 from private.purchasing_records where id=award and state='active') then raise exception 'Cancel leaked claims or recreated awards'; end if;
  begin perform pg_temp.purchasing_action(f,'reopen',po,'{"reason":"Reopen inactive supplier draft"}'); raise exception 'Inactive draft reopened'; exception when sqlstate 'P4802' then null; end;
  update private.suppliers set is_active=true where id=(f->>'supplier')::uuid;
  perform pg_temp.purchasing_action(f,'reopen',po,'{"reason":"Reopen after source review"}');
  if not exists(select 1 from private.demand_claims where owner_id=po and quantity=4) then raise exception 'Reopen did not reclaim demand'; end if;
  if (select ref from private.purchasing_records where id=po) is distinct from saved->>'ref' then raise exception 'Reopen renumbered PO'; end if;
  begin perform public.purchasing_read((f->'actor')||'{"activeRole":"Site Personnel"}',(f->>'request')::uuid); raise exception 'Site read purchasing'; exception when insufficient_privilege then null; end;
  if has_function_privilege('authenticated','public.purchasing_command(jsonb,jsonb,jsonb,jsonb)','execute') or has_function_privilege('service_role','private.purchasing_apply_claims(jsonb,uuid,uuid,text,text)','execute') or has_table_privilege('service_role','private.purchasing_records','select') then raise exception 'Purchasing private boundary exposed'; end if;
  begin delete from private.purchasing_records where id=po; raise exception 'PO history deleted'; exception when check_violation then null; end;
  begin update private.po_preparers set actor='{}' where po_id=po; raise exception 'Preparer history changed'; exception when check_violation then null; end;
end $$;
rollback;
