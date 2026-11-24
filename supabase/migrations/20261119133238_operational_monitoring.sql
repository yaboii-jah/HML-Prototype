-- Read projections only. Owning workflow commands remain the source of each fact.
create index stock_movements_account_posted on private.stock_movements(account_id,posted_at);

create function private.monitoring_consumption(projects uuid[], filters jsonb)
returns jsonb language sql stable set search_path='' as $$
  with bounds as (
    select (filters->>'from')::date::timestamp at time zone 'Asia/Manila' as starts,
      ((filters->>'to')::date+1)::timestamp at time zone 'Asia/Manila' as ends
  ), eligible as (
    select a.id,a.project_id,p.name as project,a.description,a.unit,
      trim_scale(coalesce(sum(m.quantity) filter (where m.posted_at<b.starts),0))::text as opening,
      trim_scale(coalesce(sum(m.quantity) filter (where m.posted_at>=b.starts and e.kind='opening'),0))::text as "openingEntries",
      trim_scale(coalesce(sum(m.quantity) filter (where m.posted_at>=b.starts and m.posting_kind='receipt'),0))::text as receipts,
      trim_scale(coalesce(-sum(m.quantity) filter (where m.posted_at>=b.starts and m.posting_kind='usage'),0))::text as usage,
      trim_scale(coalesce(-sum(m.quantity) filter (where m.posted_at>=b.starts and m.posting_kind='dispatch'),0))::text as dispatch,
      trim_scale(coalesce(sum(m.quantity) filter (where m.posted_at>=b.starts and m.posting_kind='adjustment'
        and e.kind is distinct from 'opening'),0))::text as corrections,
      trim_scale(sum(m.quantity))::text as closing
    from private.stock_accounts a
    join public.projects p on p.id=a.project_id
    cross join bounds b
    join private.stock_movements m on m.account_id=a.id and m.posted_at<b.ends
    left join private.inventory_entries e on e.id=m.operation_id
    where a.project_id=any(projects)
      and (nullif(filters->>'search','') is null or strpos(a.description_key,lower(filters->>'search'))>0)
      and (nullif(filters->>'unit','') is null or a.unit_key=lower(filters->>'unit'))
      and (filters->>'scopeId' is null or exists (
        select 1 from private.stock_movements receipt
        left join private.deliveries d on receipt.source_kind='purchase_receipt' and d.id=receipt.source_id
        left join private.purchasing_records po on po.id=d.po_id
        left join private.transfer_trips trip on receipt.source_kind='transfer_receipt' and trip.id=receipt.source_id
        left join private.transfers t on t.id=trip.transfer_id
        join public.material_requests r on r.id=coalesce(po.request_id,t.request_id)
        where receipt.account_id=a.id and receipt.posting_kind='receipt' and receipt.posted_at<b.ends
          and r.scope_id=(filters->>'scopeId')::uuid
      ))
    group by a.id,p.name
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'projectId',project_id,'project',project,
    'material',description,'unit',unit,'opening',opening,'openingEntries',"openingEntries",
    'receipts',receipts,'usage',usage,'dispatch',dispatch,'corrections',corrections,'closing',closing)
    order by lower(project),lower(description),lower(unit),id),'[]')
  from eligible
$$;

-- Route-neutral current receiving state. Warehouse receipts retain their own
-- custody and evidence, independently of any final-site delivery.
create function private.monitoring_shipments(projects uuid[])
returns table (id uuid, owner_id uuid, request_id uuid, project_id uuid, ref text, kind text,
  warehouse boolean, onward boolean, state text, created_at timestamptz, planned_date date,
  planned_time text, departed_at timestamptz, receipt_at timestamptz, posted_at timestamptz,
  review_state text, lines jsonb, signed_ready boolean, evidence_ready boolean, can_forward boolean)
language sql stable set search_path='' as $$
  select d.id,po.id,po.request_id,po.project_id,d.ref,'purchase',
    d.plan->>'route'='warehouse',d.parent_delivery_id is not null,d.state,d.created_at,
    (d.plan->>'plannedDate')::date,d.plan->>'plannedTime',(d.departure->>'at')::timestamptz,
    v.recorded_at,h.posted_at,h.review_state,v.snapshot->'lines',f.signed_ready,
    f.generated_ready and f.signed_ready,
    d.plan->>'route'='warehouse' and exists (
      select 1 from jsonb_array_elements(v.snapshot->'lines') l
      where (l->>'accepted')::numeric>private.delivery_warehouse_allocated(d.id,l->>'lineId'))
  from private.purchasing_records po
  join private.deliveries d on d.po_id=po.id
  left join private.delivery_receipts h on h.delivery_id=d.id
  left join private.delivery_receipt_versions v on v.delivery_id=d.id and v.revision=h.revision
  cross join lateral (
    select coalesce(bool_or(x.state='complete' and x.kind='generated'),false) as generated_ready,
      coalesce(bool_or(x.state='complete' and x.current_evidence),false) as signed_ready
    from private.delivery_receipt_files x where x.version_id=v.id
  ) f
  where po.project_id=any(projects) and d.state<>'cancelled'
  union all
  select d.id,t.id,t.request_id,t.destination_id,d.ref,'transfer',d.route='site-warehouse',
    d.parent_trip_id is not null,d.state,d.created_at,d.planned_date,d.planned_time,
    (d.departure->>'at')::timestamptz,v.recorded_at,h.posted_at,h.review_state,v.snapshot->'lines',
    f.signed_ready,f.generated_ready and f.signed_ready and not f.incomplete,
    d.route='site-warehouse' and exists (
      select 1 from jsonb_array_elements(v.snapshot->'lines') l
      where (l->>'accepted')::numeric>private.transfer_custody_used(d.id,(l->>'lineId')::uuid))
  from private.transfers t
  join private.transfer_trips d on d.transfer_id=t.id
  left join private.transfer_receipts h on h.trip_id=d.id
  left join private.transfer_receipt_versions v on v.trip_id=d.id and v.revision=h.revision
  cross join lateral (
    select coalesce(bool_or(x.state='complete' and x.kind='generated'),false) as generated_ready,
      coalesce(bool_or(x.state='complete' and x.kind='signed' and x.current_evidence),false) as signed_ready,
      coalesce(bool_or(x.state<>'complete' and x.current_evidence),false) as incomplete
    from private.transfer_receipt_files x where x.version_id=v.id
  ) f
  where t.destination_id=any(projects) and d.state<>'cancelled'
$$;

create function private.monitoring_request_items(target uuid)
returns table (id uuid, line_order bigint, material text, quantity numeric, unit text)
language sql stable set search_path='' as $$
  select (i->>'id')::uuid,ord,i->>'name',coalesce(r.quantity,(i->>'quantity')::numeric),coalesce(r.unit,i->>'unit')
  from (select s.snapshot from private.mrf_archive_snapshots s
    where s.request_id=target order by s.version desc limit 1) a
  cross join lateral jsonb_array_elements(a.snapshot->'draft'->'items') with ordinality as item(i,ord)
  left join private.demand_requirements r on r.item_id=(i->>'id')::uuid
$$;

create function private.monitoring_lifecycle(target uuid, project uuid, site boolean)
returns jsonb language sql stable set search_path='' as $$
  with shipments as materialized (
    select * from private.monitoring_shipments(array[project]) s where s.request_id=target
  ), received as (
    select c.item_id,s.warehouse,s.posted_at,(l->>'stockQuantity')::numeric as accepted
    from shipments s cross join lateral jsonb_array_elements(s.lines) l
    join private.purchasing_claims c on s.kind='purchase' and c.record_id=s.owner_id and c.line_id=(l->>'lineId')::uuid
    union all
    select t.item_id,s.warehouse,s.posted_at,(l->>'stockQuantity')::numeric
    from shipments s cross join lateral jsonb_array_elements(s.lines) l
    join private.transfer_lines t on s.kind='transfer' and t.transfer_id=s.owner_id and t.id=(l->>'lineId')::uuid
  ), quantities as (
    select item_id,sum(accepted) filter(where not warehouse) as accepted,
      sum(accepted) filter(where not warehouse and posted_at is not null) as posted
    from received group by item_id
  ), demand as (
    select i.id,i.line_order,i.material,i.quantity,i.unit,
      sum(c.quantity) filter(where c.owner_kind='suitability') as hold,
      sum(c.quantity) filter(where c.owner_kind='award') as awarded,
      sum(c.quantity) filter(where c.owner_kind='purchase_order' and issued.po_id is null) as purchasing,
      sum(c.quantity) filter(where c.owner_kind='purchase_order' and issued.po_id is not null) as issued,
      sum(c.quantity) filter(where t.status='release_pending') as release_pending,
      sum(c.quantity) filter(where t.status='approved') as transfers,
      i.quantity-coalesce(sum(c.quantity),0) as unassigned
    from private.monitoring_request_items(target) i
    left join private.demand_claims c on c.item_id=i.id
    left join private.po_issuances issued on c.owner_kind='purchase_order' and issued.po_id=c.owner_id
    left join private.transfers t on c.owner_kind='transfer' and t.id=c.owner_id
    group by i.id,i.line_order,i.material,i.quantity,i.unit
  ), pay as (
    select p.id,p.ref as po,private.payment_settled(p.id) as settled,private.payment_cleared(p.id) as cleared,
      private.payment_clearance_blockers(p.id) as blockers
    from private.purchasing_records p join private.po_issuances issued on issued.po_id=p.id
    where not site and p.request_id=target
  )
  select jsonb_build_object(
    'target',target,
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',d.id,'material',coalesce(d.material,''),'unit',d.unit,'requested',trim_scale(d.quantity)::text,
      'hold',trim_scale(coalesce(d.hold,0))::text,'awarded',trim_scale(coalesce(d.awarded,0))::text,
      'purchasing',trim_scale(coalesce(d.purchasing,0))::text,
      'releasePending',trim_scale(coalesce(d.release_pending,0))::text,
      'confirmed',trim_scale(coalesce(d.issued,0)+coalesce(d.transfers,0))::text,
      'unassigned',trim_scale(d.unassigned)::text,'accepted',trim_scale(coalesce(q.accepted,0))::text,
      'posted',trim_scale(coalesce(q.posted,0))::text) order by d.line_order,d.id)
      from demand d left join quantities q on q.item_id=d.id),'[]'),
    'blockers',to_jsonb(array_remove(array[
      case when exists(select 1 from demand where unassigned>0) then 'Some quantities still need a source.' end,
      case when exists(select 1 from demand where hold>0) then 'A proposed stock transfer is under review.' end,
      case when exists(select 1 from demand where release_pending>0) then 'A transfer is waiting for the source site to approve release.' end,
      case when exists(select 1 from demand where awarded>0 or purchasing>0) then 'Purchasing is in progress.' end,
      case when exists(select 1 from shipments where state='scheduled') then 'A shipment is scheduled for departure.' end,
      case when exists(select 1 from shipments where can_forward) then 'Materials are awaiting onward delivery from the warehouse.' end,
      case when exists(select 1 from shipments where state='dispatched' and receipt_at is null)
        then 'A shipment is awaiting receipt confirmation.' end,
      case when exists(select 1 from shipments where receipt_at is not null and not warehouse and posted_at is null
        and exists(select 1 from jsonb_array_elements(lines) l where (l->>'accepted')::numeric>0))
        then 'Accepted materials are awaiting inventory posting.' end,
      case when exists(select 1 from shipments where receipt_at is not null and review_state<>'approved')
        then 'Receipt evidence is awaiting completion or review.' end
    ],null)),
    'shipments',case when site then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
      'ref',ref,'href',case kind when 'purchase' then '/deliveries/'||id else '/stock-transfers/'||owner_id end,
      'warehouse',warehouse,'state',state,'received',receipt_at is not null,'posted',posted_at is not null,
      'evidence',coalesce(review_state,''),'forward',can_forward) order by created_at,id) from shipments),'[]') end,
    'purchasing',coalesce((select jsonb_agg(jsonb_build_object('ref',po,'href','/finance/'||id,
      'settled',settled,'cleared',cleared,'blockers',blockers) order by po) from pay),'[]')
  )
$$;

create function private.monitoring_queue(projects uuid[], role_name text, caller uuid, ready_only boolean)
returns jsonb language sql stable set search_path='' as $$
  with r as materialized (
    select m.* from public.material_requests m where m.project_id=any(projects)
      and m.status not in ('draft','rejected')
  ), po as materialized (
    select p.*,i.recorded_at as issued_at
    from private.purchasing_records p left join private.po_issuances i on i.po_id=p.id
    where role_name in ('Procurement','Accounting','Finance','Logistics') and p.project_id=any(projects) and p.state='active'
  ), issued as materialized (
    select p.*,private.payment_settled(p.id) as settled,private.payment_cleared(p.id) as cleared,
      private.payment_clearance_blockers(p.id) as clearance_blockers,
      p.body->'payment'->>'mode'='credit' and nullif(p.body->'payment'->>'dueDate','')::date<(now() at time zone 'Asia/Manila')::date
        and private.payment_paid(p.id)<(p.calculation->>'net')::numeric as overdue,
      coalesce(h.ledger_version,0) as ledger, c.ledger_version as planned_ledger,c.recorded_at as coordinated_at,
      nullif(c.plan->>'plannedDate','')::date as planned_payment_date,
      c.plan->>'status' as coordination_status
    from po p left join private.payment_heads h on h.po_id=p.id
    left join lateral (select co.* from private.payment_coordination co where co.po_id=p.id
      order by co.recorded_at desc,co.id desc limit 1) c on true
    where p.issued_at is not null
  ), shipments as (
    select s.*,case when s.kind='purchase' then '/deliveries/'||s.id else '/stock-transfers/'||s.owner_id end as href,
      case when s.warehouse then 'Procurement' else 'Site Personnel' end as receiver,
      s.planned_date<(now() at time zone 'Asia/Manila')::date as missed,
      exists(select 1 from jsonb_array_elements(s.lines) l where (l->>'accepted')::numeric>0) as has_stock
    from private.monitoring_shipments(projects) s
    where role_name in ('Procurement','Site Personnel','Accounting','Logistics')
  ), tasks(project_id,id,ref,href,action,blocker,at,flag) as (
    select r.project_id,r.id,r.ref,'/requests/'||r.id,'Correct material request',null,r.updated_at,null
    from r where role_name='Site Personnel' and (r.status='returned' or r.correction_state in ('editing','returned'))
    union all
    select r.project_id,r.id,r.ref,'/requests/'||r.id,'Review material request',
      case when exists(select 1 from private.mrf_submissions s where s.request_id=r.id and s.actor_id=caller)
        then 'Another Project Manager must approve this request.'
        when r.correction_kind is distinct from 'documents' and not exists(select 1 from public.scope_budgets b where b.scope_id=r.scope_id and b.amount>0)
        then 'The project scope needs funding before approval.'
        when not exists(select 1 from private.mrf_submissions s join private.request_document_state d on d.request_id=s.request_id
          where s.id=r.submission_id and d.current_document=s.source_document and d.revision=s.attachment_revision)
        then 'Waiting for a submission with its current supporting PDF.' end,r.updated_at,null
    from r where role_name='Project Manager' and (r.status='submitted' or r.correction_state='submitted')
    union all
    select r.project_id,r.id,r.ref,'/requests/'||r.id,'Follow up on review','Waiting for Project Manager review.',r.updated_at,null
    from r where role_name='Site Personnel' and (r.status='submitted' or r.correction_state='submitted')
    union all
    select r.project_id,r.id,r.ref,'/requests/'||r.id||'/purchasing','Source remaining material',
      case when not private.mrf_ready(r.id) then 'Waiting for the approved request archive or correction.' end,r.updated_at,null
    from r where role_name='Procurement' and r.status='approved' and (
      not exists(select 1 from private.demand_heads h where h.request_id=r.id) or exists (
        select 1 from private.monitoring_request_items(r.id) d where d.quantity>(
          select coalesce(sum(c.quantity),0) from private.demand_claims c where c.item_id=d.id)))
    union all
    select r.project_id,q.id,r.ref,'/requests/'||r.id||'/quotes/'||q.id,'Complete quotation',
      case when not private.mrf_ready(r.id) then 'Waiting for the approved request archive or correction.' end,q.created_at,null
    from r join private.quotation_drafts q on q.request_id=r.id
    where role_name='Procurement' and q.state='draft' and not exists (
      select 1 from private.quotation_revisions v where v.quote_id=q.id)
    union all
    select p.project_id,p.id,r.ref,'/requests/'||r.id||'/purchasing','Convert saved award',
      case when private.purchasing_blockers(p.id)<>'[]'::jsonb
        then array_to_string(array(select jsonb_array_elements_text(private.purchasing_blockers(p.id))), ' • ') end,p.updated_at,null
    from po p join r on r.id=p.request_id where role_name='Procurement' and p.kind='award'
    union all
    select p.project_id,p.id,p.ref,'/purchase-orders/'||p.id,'Prepare purchase order',
      case when not private.mrf_ready(p.request_id) then 'Waiting for the approved request archive or correction.' end,p.updated_at,null
    from po p where role_name='Procurement' and p.kind='po' and p.po_status in ('draft','returned')
    union all
    select p.project_id,p.id,p.ref,'/accounting/'||p.id,'Review purchase order',
      case when private.po_cannot_approve(p.id,caller) then 'Another Accounting reviewer must approve this order.'
        when not coalesce((private.purchasing_preparation_view(p.id)->>'checked')::boolean,false) or not private.po_terms_ready(p.body)
          then 'Waiting for current source, pricing and payment terms.'
        when coalesce(private.scope_uncommitted(r.scope_id),-1)<(p.calculation->>'gross')::numeric
          then 'Waiting for sufficient uncommitted scope allocation.'
        when not exists(select 1 from private.project_document_folders d where d.project_id=p.project_id and d.current)
          then 'Waiting for the project document folder.' end,p.updated_at,null
    from po p join r on r.id=p.request_id where role_name='Accounting' and p.kind='po' and p.po_status in ('submitted','held')
    union all
    select p.project_id,p.id,p.ref,'/purchase-orders/'||p.id,'Issue purchase order',
      case when private.approved_po_blockers(p.id)<>'[]'::jsonb or not private.po_terms_ready(p.body) or not exists (
        select 1 from private.po_archives a join private.po_archive_jobs j on j.id=a.job_id where j.approval_id=p.approval_id)
        then 'Waiting for approved documents or issuance checks.' end,p.updated_at,null
    from po p where role_name='Procurement' and p.kind='po' and p.po_status='approved' and p.issued_at is null
    union all
    select t.destination_id,t.id,r.ref,'/stock-transfers/'||t.id,'Confirm transfer suitability',null,t.created_at,null
    from private.transfers t join r on r.id=t.request_id
    where role_name='Site Personnel' and t.status='review_pending' and t.destination_id=any(projects)
    union all
    select t.source_id,t.id,coalesce(t.ref,'Stock release'),'/stock-transfers/'||t.id,'Approve source stock release',
      case when t.submitted_by=caller or t.suitability_reviewer=caller then 'Another assigned Site user must approve this release.' end,t.created_at,null
    from private.transfers t where role_name='Site Personnel' and t.status='release_pending' and t.source_id=any(projects)
    union all
    select t.destination_id,t.id,r.ref,'/stock-transfers/'||t.id,'Request source stock release',null,t.created_at,null
    from private.transfers t join r on r.id=t.request_id
    where role_name='Procurement' and t.status='suitable' and t.destination_id=any(projects)
    union all
    select t.destination_id,t.id,coalesce(t.ref,r.ref),'/stock-transfers/'||t.id,'Follow up on stock transfer',
      case t.status when 'release_pending' then 'Waiting for source-site approval.' else 'Waiting for destination suitability review.' end,t.created_at,null
    from private.transfers t join r on r.id=t.request_id
    where t.destination_id=any(projects) and (role_name='Procurement' and t.status in ('release_pending','review_pending')
      or role_name='Site Personnel' and t.status='release_pending')
    union all
    select t.destination_id,t.id,t.ref,'/stock-transfers/'||t.id,'Book stock transfer',null,t.created_at,null
    from private.transfers t where role_name='Logistics' and t.status='approved' and t.destination_id=any(projects)
      and exists (
        select 1 from private.transfer_lines l where l.transfer_id=t.id and l.approved-l.released>(
          select coalesce(sum(x.quantity),0) from private.transfer_trip_lines x join private.transfer_trips trip on trip.id=x.trip_id
          where x.line_id=l.id and trip.parent_trip_id is null and trip.state<>'cancelled'))
    union all
    select p.project_id,p.id,p.ref,'/deliveries/new?poId='||p.id,'Book purchased delivery',null,p.issued_at,null
    from issued p where role_name='Logistics' and exists (
      select 1 from jsonb_array_elements(p.body->'lines') l where (l->>'offeredQuantity')::numeric>(
        select coalesce(sum((x->>'quantity')::numeric),0)
        from private.deliveries d cross join lateral jsonb_array_elements(d.plan->'lines') x
        where d.po_id=p.id and d.parent_delivery_id is null and d.state<>'cancelled' and x->>'lineId'=l->>'id'))
    union all
    select p.project_id,p.id,p.ref,'/finance/'||p.id,
      case when p.coordinated_at is null then 'Coordinate supplier payment' else 'Follow up on supplier payment' end,
      case when exists(select 1 from private.payment_participants x where x.po_id=p.id and x.actor_id=caller and x.kind='settle')
        then 'Another Finance user must coordinate this payment.'
        when p.planned_ledger=p.ledger and not p.overdue
          and (p.planned_payment_date is null or p.planned_payment_date>(now() at time zone 'Asia/Manila')::date)
          and p.coordination_status<>'Delayed' then 'Waiting for a payment or a verified balance change.' end,
      coalesce(p.coordinated_at,p.issued_at),case when p.overdue then 'Overdue Credit' end
    from issued p where role_name='Finance' and not p.settled
    union all
    select p.project_id,p.id,p.ref,'/finance/'||p.id,
      case when (p.calculation->>'net')::numeric=0 then 'Confirm no-cash settlement'
        when exists (select 1 from private.payment_drafts d where d.po_id=p.id and d.state='draft'
          and cardinality(d.current_files)>0 and not exists(select 1 from private.payment_groups g
            where g.draft_id=d.id and g.state in ('uploading','conflict'))) then 'Verify supplier payment'
        else 'Record supplier payment evidence' end,
      case when exists(select 1 from private.payment_participants x where x.po_id=p.id and x.actor_id=caller and x.kind='coordinate')
        then 'Another Accounting user must verify settlement.' end,p.issued_at,
      case when p.overdue then 'Overdue Credit' end
    from issued p where role_name='Accounting' and not p.settled
    union all
    select p.project_id,p.id,p.ref,'/finance/'||p.id,'Clear delivery',
      case when p.clearance_blockers<>'[]'::jsonb then array_to_string(array(
        select jsonb_array_elements_text(p.clearance_blockers)), ' • ') end,p.issued_at,null
    from issued p where role_name='Accounting' and not p.cleared
    union all
    select s.project_id,s.id,s.ref,s.href,'Dispatch shipment',
      case when s.kind='purchase' and not s.onward and not private.payment_cleared(s.owner_id)
        then 'Waiting for Accounting delivery clearance.' end,s.created_at,case when s.missed then 'Missed shipment plan' end
    from shipments s where role_name='Logistics' and s.state='scheduled'
    union all
    select s.project_id,s.id,s.ref,s.href,'Forward warehouse stock',null,s.receipt_at,null
    from shipments s where role_name='Logistics' and s.can_forward
    union all
    select s.project_id,s.id,s.ref,s.href,'Confirm receiving',null,s.departed_at,null
    from shipments s where role_name=s.receiver and s.state='dispatched' and s.receipt_at is null
    union all
    select s.project_id,s.id,s.ref,s.href,'Post accepted site stock',null,s.receipt_at,null
    from shipments s where role_name='Site Personnel' and not s.warehouse and s.receipt_at is not null
      and s.has_stock and s.posted_at is null
    union all
    select s.project_id,s.id,s.ref,s.href,'Complete receipt evidence',null,s.receipt_at,null
    from shipments s where role_name=s.receiver and s.receipt_at is not null and s.review_state<>'approved'
      and (not s.signed_ready or s.review_state='needs_evidence')
    union all
    select s.project_id,s.id,s.ref,s.href,'Review receipt evidence',
      case when not s.evidence_ready or s.review_state='needs_evidence' then 'Waiting for verified receipt documents.' end,s.receipt_at,null
    from shipments s where role_name='Accounting' and s.receipt_at is not null and s.review_state<>'approved'
    union all
    select s.project_id,s.id,s.ref,s.href,'Follow up on shipment',
      case when s.receipt_at is null then 'Waiting for receiving confirmation.' else 'Waiting for site inventory posting.' end,
      coalesce(s.receipt_at,s.departed_at),null
    from shipments s where role_name='Logistics' and s.state='dispatched'
      and (s.receipt_at is null or not s.warehouse and s.has_stock and s.posted_at is null)
  ), visible as (
    select distinct on (id,action) * from tasks where not ready_only or blocker is null
    order by id,action,at desc nulls last
  )
  select jsonb_build_object('count',count(*) filter(where blocker is null),
    'actions',case when ready_only then '[]'::jsonb else coalesce(jsonb_agg(jsonb_build_object(
      'key',id||':'||action,'projectId',project_id,'ref',ref,'href',href,'label',action,'blocker',blocker,'at',at,'flag',flag)
      order by (flag is null),at nulls last,id,action),'[]') end)
  from visible
$$;

create function private.monitoring_reports(projects uuid[], filters jsonb)
returns jsonb language sql stable set search_path='' as $$
  with bounds as (
    select (filters->>'from')::date::timestamp at time zone 'Asia/Manila' as starts,
      ((filters->>'to')::date+1)::timestamp at time zone 'Asia/Manila' as ends
  ), shipments as materialized (
    select s.*,case when s.kind='purchase' then '/deliveries/'||s.id else '/stock-transfers/'||s.owner_id end as href
    from private.monitoring_shipments(projects) s
  ), payments as materialized (
    select p.id,p.project_id,p.ref,p.body->'payment'->>'mode'='credit' as credit,
      nullif(p.body->'payment'->>'dueDate','')::date as due,
      (p.calculation->>'net')::numeric as net,private.payment_paid(p.id) as paid,
      private.payment_settled(p.id) as settled, private.payment_cleared(p.id) as cleared,
      private.payment_clearance_blockers(p.id) as blockers
    from private.purchasing_records p join private.po_issuances i on i.po_id=p.id
    where p.project_id=any(projects)
  ), event_batch(project_id,label,at) as (
    select m.project_id,case e.action when 'submitted' then 'MRF submissions' when 'approve' then 'MRF approvals'
      when 'return' then 'MRFs returned' else 'MRFs rejected' end,e.created_at
    from private.mrf_review_events e join public.material_requests m on m.id=e.request_id
    where m.project_id=any(projects) and e.action in ('submitted','approve','return','reject')
    union all
    select p.project_id,'Supplier PO issuances',i.recorded_at
    from private.po_issuances i join payments p on p.id=i.po_id
    union all
    select s.project_id,case e.action when 'dispatch' then 'Purchased shipment dispatches'
      when 'receive' then 'Purchased receipts confirmed' else 'Purchased receipts recounted' end,e.recorded_at
    from private.delivery_events e join shipments s on s.id=e.delivery_id and s.kind='purchase'
    where e.action in ('dispatch','receive','recount')
    union all
    select s.project_id,case e.action when 'dispatchTrip' then 'Transfer shipment dispatches'
      when 'receiveTrip' then 'Transfer receipts confirmed' else 'Transfer receipts recounted' end,e.recorded_at
    from private.transfer_trip_events e join shipments s on s.id=e.trip_id and s.kind='transfer'
    where e.action in ('dispatchTrip','receiveTrip','recountTrip')
    union all
    select a.project_id,case m.posting_kind
      when 'receipt' then 'Site receipt stock postings' when 'usage' then 'Usage entries posted'
      when 'dispatch' then 'Source stock dispatch postings'
      else case i.kind when 'opening' then 'Opening stock entries posted' else 'Stock corrections posted' end end,
      min(m.posted_at)
    from private.stock_accounts a join private.stock_movements m on m.account_id=a.id
    left join private.inventory_entries i on i.id=m.operation_id
    where a.project_id=any(projects) group by a.project_id,m.operation_id,m.posting_kind,i.kind
    union all
    select p.project_id,'Supplier payments verified',v.verified_at
    from private.payment_verifications v join payments p on p.id=v.po_id
    union all
    select p.project_id,'Supplier payment verifications reversed',x.recorded_at
    from private.payment_reversals x join private.payment_verifications v on v.id=x.verification_id
    join payments p on p.id=v.po_id
  ), activity as (
    select project_id,label,count(*) as total from event_batch cross join bounds
    where (starts is null or at>=starts) and (ends is null or at<ends)
    group by project_id,label
  ), issues(project_id,ref,href,label) as (
    select s.project_id,s.ref,s.href,issue.label from shipments s
    cross join lateral (values
      ('Missed shipment plan',s.state='scheduled' and s.planned_date<(now() at time zone 'Asia/Manila')::date),
      ('Receipt confirmation pending',s.state='dispatched' and s.receipt_at is null),
      ('Warehouse stock awaiting forwarding',s.can_forward),
      ('Site stock posting pending',not s.warehouse and s.receipt_at is not null and s.posted_at is null
        and exists(select 1 from jsonb_array_elements(s.lines) l where (l->>'accepted')::numeric>0)),
      ('Receipt discrepancy recorded',exists(select 1 from jsonb_array_elements(s.lines) l
        where (l->>'missing')::numeric>0 or (l->>'rejected')::numeric>0)),
      (case when not s.evidence_ready then 'Receipt documents incomplete' else 'Receipt evidence review pending' end,
        s.receipt_at is not null and s.review_state<>'approved')
    ) issue(label,open) where issue.open
    union all
    select p.project_id,p.ref,'/finance/'||p.id,'Overdue unpaid Credit'
    from payments p where p.credit and p.net>p.paid and p.due<(now() at time zone 'Asia/Manila')::date
    union all
    select p.project_id,p.ref,'/finance/'||p.id,b.label from payments p
    cross join lateral jsonb_array_elements_text(case when p.blockers='[]'::jsonb then '["Delivery clearance pending"]'::jsonb else p.blockers end) b(label)
    where not p.cleared
    union all
    select r.project_id,r.ref,'/requests/'||r.id,'Approved request archive pending'
    from public.material_requests r where r.project_id=any(projects) and r.status='approved'
      and r.correction_kind is null and not private.mrf_ready(r.id)
    union all
    select p.project_id,p.ref,'/purchase-orders/'||p.id,'Approved PO archive pending'
    from private.purchasing_records p where p.project_id=any(projects) and p.kind='po' and p.state='active'
      and p.po_status='approved' and not exists (
        select 1 from private.po_archive_jobs j join private.po_archives a on a.job_id=j.id where j.approval_id=p.approval_id and j.state='complete')
  ), totals as (
    select p.id,p.name,private.project_summary(p.id,true)->'financial' as budget,
      coalesce(sum(q.paid),0)::text as paid,
      coalesce(sum(q.net-q.paid) filter (where q.credit),0)::text as credit,
      coalesce(sum(q.net-q.paid) filter (where q.credit and q.due<(now() at time zone 'Asia/Manila')::date),0)::text as overdue,
      count(q.id) filter(where not q.settled) as unsettled,
      count(q.id) filter(where not q.cleared) as uncleared
    from public.projects p left join payments q on q.project_id=p.id where p.id=any(projects) group by p.id
  )
  select jsonb_build_object(
    'activity',coalesce((select jsonb_agg(jsonb_build_object('projectId',project_id,'label',label,'total',total)
      order by project_id,label) from activity),'[]'),
    'exceptions',coalesce((select jsonb_agg(jsonb_build_object('projectId',project_id,'ref',ref,'href',href,'label',label)
      order by project_id,ref,label) from issues),'[]'),
    'balances',private.stock_snapshot(array(select a.id from private.stock_accounts a where a.project_id=any(projects))),
    'financial',coalesce((select jsonb_agg(jsonb_build_object('projectId',id,'allocated',budget->>'allocated',
      'committed',budget->>'committed','spent',budget->>'spent','available',budget->>'uncommitted',
      'paid',paid,'credit',credit,'overdue',overdue,'unsettled',unsettled,'uncleared',uncleared)
      order by lower(name),id) from totals),'[]')
  )
$$;

create function public.monitoring_read(viewer jsonb, mode text, filters jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  caller uuid:=private.delivery_actor(viewer);
  role_name text:=viewer->>'activeRole';
  selected uuid:=(filters->>'projectId')::uuid;
  target uuid:=(filters->>'target')::uuid;
  all_projects uuid[];
  visible uuid[];
  result jsonb;
begin
  if coalesce(mode,'') not in ('bell','dashboard','lifecycle','reports','consumption')
    or mode='reports' and role_name='Site Personnel' then
    raise exception 'Monitoring view unavailable' using errcode='42501';
  end if;
  select array(select p.id from public.projects p where private.request_project_allowed(viewer,p.id)) into all_projects;
  visible:=case when selected is null then all_projects else array(select x from unnest(all_projects) x where x=selected) end;
  if selected is not null and cardinality(visible)=0 then
    raise exception 'Monitoring project unavailable' using errcode='42501';
  end if;
  if filters->>'scopeId' is not null and not exists(
    select 1 from public.scopes s where s.id=(filters->>'scopeId')::uuid and s.project_id=any(visible)
  ) then raise exception 'Monitoring scope unavailable' using errcode='42501'; end if;
  if mode='bell' then return private.monitoring_queue(all_projects,role_name,caller,true); end if;
  if mode='lifecycle' then
    select private.monitoring_lifecycle(r.id,r.project_id,role_name='Site Personnel') into result
    from public.material_requests r where r.id=target and r.project_id=any(visible);
    return result;
  end if;
  if mode='dashboard' then
    result:=private.monitoring_queue(visible,role_name,caller,false)||jsonb_build_object('overview',coalesce((
      select jsonb_agg(jsonb_build_object('projectId',t.id,'draft',t.draft,'review',t.review,'approved',t.approved) order by t.id)
      from (select p.id,count(r.id) filter(where r.status in ('draft','returned')) as draft,
        count(r.id) filter(where r.status='submitted' or r.correction_state='submitted') as review,
        count(r.id) filter(where r.status='approved' and r.correction_state is distinct from 'submitted') as approved
        from public.projects p left join public.material_requests r on r.project_id=p.id
        where p.id=any(visible) group by p.id) t),'[]'));
  elsif mode='reports' then
    result:=private.monitoring_reports(visible,filters);
  else
    result:=jsonb_build_object('rows',private.monitoring_consumption(visible,filters),'scopes',coalesce((
      select jsonb_agg(jsonb_build_object('id',s.id,'projectId',s.project_id,'name',s.name) order by lower(s.name),s.id)
      from public.scopes s where s.project_id=any(all_projects)),'[]'));
  end if;
  return result||jsonb_build_object('projects',coalesce((
    select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name) order by lower(p.name),p.id)
    from public.projects p where p.id=any(all_projects)),'[]'));
end $$;

revoke all on function private.monitoring_consumption(uuid[],jsonb),private.monitoring_shipments(uuid[]),
  private.monitoring_request_items(uuid),private.monitoring_lifecycle(uuid,uuid,boolean),private.monitoring_queue(uuid[],text,uuid,boolean),
  private.monitoring_reports(uuid[],jsonb),public.monitoring_read(jsonb,text,jsonb)
from public,anon,authenticated,service_role;
grant execute on function public.monitoring_read(jsonb,text,jsonb) to service_role;
