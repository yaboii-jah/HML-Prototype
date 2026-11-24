-- Only new admissions use request folders. Existing jobs and upload sessions
-- keep their recorded destinations, including work without a Drive file yet.
create table private.request_drive_admissions (
  kind text not null,
  resource_id uuid not null,
  request_id uuid not null references public.material_requests(id),
  path jsonb not null,
  primary key (kind, resource_id)
);
create index request_drive_admissions_request on private.request_drive_admissions(request_id);

create table private.request_drive_folders (
  project_folder_id text not null references private.document_folder_owners(folder_id),
  request_id uuid not null references public.material_requests(id),
  path_key text not null,
  folder_id text not null unique check (folder_id ~ '^[A-Za-z0-9_-]+$'),
  name text not null,
  primary key (project_folder_id, request_id, path_key)
);
create index request_drive_folders_request on private.request_drive_folders(request_id);
alter table private.request_drive_admissions enable row level security;
alter table private.request_drive_folders enable row level security;
revoke all on private.request_drive_admissions, private.request_drive_folders from public, anon, authenticated, service_role;

create function private.drive_path_segment(key text, name text) returns jsonb
language sql immutable strict set search_path='' as $$
  select jsonb_build_array(jsonb_build_object('key',key,'name',name))
$$;

create function private.admit_request_drive_file() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  kind text := tg_argv[0];
  request_id uuid;
  parent_id uuid;
  parent_name text;
  child_id uuid;
  child_name text;
  path jsonb;
begin
  case kind
    when 'mrf-original' then
      request_id := new.request_id;
      path := private.drive_path_segment('support','Supporting Documents')
        || private.drive_path_segment('support/originals','Originals');
    when 'mrf-archive' then
      insert into private.request_drive_admissions(kind,resource_id,request_id,path) values
        ('mrf-form',new.id,new.request_id,private.drive_path_segment('mrf','MRF Form')),
        ('mrf-support',new.id,new.request_id,private.drive_path_segment('support','Supporting Documents'));
      return null;
    when 'quotation-original' then
      select q.request_id,q.supplier_id,s.profile->>'name' into request_id,parent_id,parent_name
      from private.quotation_drafts q join private.suppliers s on s.id=q.supplier_id
      where q.id=new.quote_id;
    when 'quotation-review' then
      select q.request_id,q.supplier_id,s.profile->>'name' into request_id,parent_id,parent_name
      from private.quotation_revisions v join private.quotation_drafts q on q.id=v.quote_id
      join private.suppliers s on s.id=q.supplier_id where v.id=new.revision_id;
    when 'comparison' then
      select r.request_id into request_id from private.comparison_reports r where r.id=new.report_id;
      path := private.drive_path_segment('comparisons','Bid Comparisons');
    when 'po' then
      select a.request_id into request_id from private.po_approvals a where a.id=new.approval_id;
      path := private.drive_path_segment('po','Purchase Orders');
    when 'payment' then
      select p.request_id,p.id,p.ref into request_id,parent_id,parent_name
      from private.payment_drafts d join private.purchasing_records p on p.id=d.po_id where d.id=new.draft_id;
      path := private.drive_path_segment('accounting','Accounting Documents')
        || private.drive_path_segment('accounting/'||parent_id,parent_name)
        || private.drive_path_segment('accounting/'||parent_id||'/proof','Payment Proof');
    when 'delivery' then
      select p.request_id,p.id,p.ref,d.id,d.ref into request_id,parent_id,parent_name,child_id,child_name
      from private.delivery_receipt_versions v join private.deliveries d on d.id=v.delivery_id
      join private.purchasing_records p on p.id=d.po_id where v.id=new.version_id;
      path := private.drive_path_segment('delivery','Delivery Receipts')
        || private.drive_path_segment('delivery/'||parent_id,parent_name)
        || private.drive_path_segment('delivery/'||parent_id||'/'||child_id,child_name);
    when 'transfer' then
      select t.request_id,t.id,t.ref,d.id,d.ref into request_id,parent_id,parent_name,child_id,child_name
      from private.transfer_receipt_versions v join private.transfer_trips d on d.id=v.trip_id
      join private.transfers t on t.id=d.transfer_id where v.id=new.version_id;
      path := private.drive_path_segment('transfer','Stock Transfers')
        || private.drive_path_segment('transfer/'||parent_id,parent_name)
        || private.drive_path_segment('transfer/'||parent_id||'/'||child_id,child_name);
  end case;
  if kind in ('quotation-original','quotation-review') then
    path := private.drive_path_segment('quotations','Supplier Quotations')
      || private.drive_path_segment('quotations/'||parent_id,parent_name);
  end if;
  insert into private.request_drive_admissions values(kind,new.id,request_id,path);
  return null;
end $$;
revoke all on function private.admit_request_drive_file() from public, anon, authenticated;
revoke all on function private.drive_path_segment(text,text) from public, anon, authenticated;

create trigger admit_request_drive_file after insert on private.document_uploads
  for each row execute function private.admit_request_drive_file('mrf-original');
create trigger admit_request_drive_file after insert on private.mrf_archive_snapshots
  for each row execute function private.admit_request_drive_file('mrf-archive');
create trigger admit_request_drive_file after insert on private.quotation_files
  for each row execute function private.admit_request_drive_file('quotation-original');
create trigger admit_request_drive_file after insert on private.quotation_archive_jobs
  for each row execute function private.admit_request_drive_file('quotation-review');
create trigger admit_request_drive_file after insert on private.comparison_artifacts
  for each row execute function private.admit_request_drive_file('comparison');
create trigger admit_request_drive_file after insert on private.po_archive_jobs
  for each row execute function private.admit_request_drive_file('po');
create trigger admit_request_drive_file after insert on private.payment_files
  for each row execute function private.admit_request_drive_file('payment');
create trigger admit_request_drive_file after insert on private.delivery_receipt_files
  for each row execute function private.admit_request_drive_file('delivery');
create trigger admit_request_drive_file after insert on private.transfer_receipt_files
  for each row execute function private.admit_request_drive_file('transfer');

-- The checked caller has already loaded the job and its frozen project mapping.
-- Reserve all missing segments in root-to-leaf order in one short transaction.
create function private.request_drive_path(resource_kind text, target uuid, project_folder text, candidates jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  admission private.request_drive_admissions;
  request public.material_requests;
  segment jsonb;
  segment_key text;
  candidate text;
  folder private.request_drive_folders;
  result jsonb := '[]'::jsonb;
begin
  select * into admission from private.request_drive_admissions a
  where a.kind=resource_kind and a.resource_id=target;
  if not found then return null; end if;

  select * into strict request from public.material_requests where id=admission.request_id;
  if not exists(select 1 from private.document_folder_owners
    where folder_id=project_folder and project_id=request.project_id) then
    raise exception 'Drive project folder is not owned by this request' using errcode='23514';
  end if;

  for segment in select value from jsonb_array_elements(private.drive_path_segment('request',request.ref)||admission.path) loop
    segment_key := segment->>'key';
    candidate := candidates->>segment_key;
    if candidate is not null then
      insert into private.request_drive_folders(project_folder_id,request_id,path_key,folder_id,name)
      values(project_folder,request.id,segment_key,candidate,segment->>'name')
      on conflict (project_folder_id,request_id,path_key) do nothing;
    end if;
    select * into folder from private.request_drive_folders f
    where f.project_folder_id=project_folder and f.request_id=request.id and f.path_key=segment_key;
    result := result || jsonb_build_array(jsonb_build_object('key',segment_key,
      'name',coalesce(folder.name,segment->>'name'),'id',folder.folder_id));
  end loop;
  return jsonb_build_object('requestId',request.id,'folders',result);
end $$;
create function public.request_drive_path(resource_kind text, target uuid, project_folder text, candidates jsonb)
returns jsonb language sql set search_path='' as $$
  select private.request_drive_path(resource_kind,target,project_folder,candidates)
$$;
revoke all on function private.request_drive_path(text,uuid,text,jsonb),
  public.request_drive_path(text,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function private.request_drive_path(text,uuid,text,jsonb),
  public.request_drive_path(text,uuid,text,jsonb) to service_role;

create or replace function private.issuance_files(target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  r private.purchasing_records;
  m uuid;
  a private.mrf_archives;
  f private.po_archives;
  project_folder text;
  po_folder text;
begin
  select * into r from private.purchasing_records where id=target;
  m:=private.quotation_mrf_archive(r.request_id);
  select * into a from private.mrf_archives where snapshot_id=m;
  select x.* into f from private.po_archives x join private.po_archive_jobs j on j.id=x.job_id where j.approval_id=r.approval_id;
  if r.po_status<>'approved' or r.state<>'active' or a.snapshot_id is null or f.job_id is null then
    raise exception 'Complete current MRF and approved PO archives required' using errcode='P4102';
  end if;
  select folder_id into strict project_folder from private.project_document_folders where id=f.folder_mapping_id;
  po_folder:=project_folder;
  if exists(select 1 from private.request_drive_admissions where kind='po' and resource_id=f.job_id) then
    select folder_id into po_folder from private.request_drive_folders
    where project_folder_id=project_folder and request_id=r.request_id and path_key='po';
    if po_folder is null then
      raise exception 'Verified purchase order folder required' using errcode='P4102';
    end if;
  end if;
  return jsonb_build_object('approvalId',r.approval_id,'mrfArchiveId',m,'poArchiveId',f.job_id,
    'files',jsonb_build_array(
      jsonb_build_object('id',a.form_file_id,'sha256',a.form_sha256,
        'size',(select size::text from private.mrf_archive_files where snapshot_id=m and kind='form'),
        'tags',jsonb_build_object('hmlSnapshotId',m,'hmlKind','approved-mrf')),
      jsonb_build_object('id',a.supporting_file_id,'sha256',a.supporting_sha256,
        'size',(select size::text from private.mrf_archive_files where snapshot_id=m and kind='supporting'),
        'tags',jsonb_build_object('hmlSnapshotId',m,'hmlKind','approved-support')),
      jsonb_build_object('id',f.file_id,'sha256',f.sha256,'size',f.size::text,
        'parent',po_folder,
        'tags',jsonb_build_object('hmlPoArchive',f.job_id,'hmlPoApproval',r.approval_id,'hmlKind','approved-po'))));
end $$;
