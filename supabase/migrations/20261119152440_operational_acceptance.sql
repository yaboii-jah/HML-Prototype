-- Share exact demand and destination receipt facts between detail and dashboard reads.
create function private.monitoring_line_facts(targets uuid[])
returns table (request_id uuid,id uuid,line_order bigint,material text,quantity numeric,unit text,
  hold numeric,awarded numeric,purchasing numeric,issued numeric,release_pending numeric,transfers numeric,
  unassigned numeric,accepted numeric,posted numeric)
language sql stable set search_path='' as $$
  with received as (
    select claim.item_id,(line->>'stockQuantity')::numeric as quantity,h.posted_at
    from private.purchasing_records po
    join private.deliveries d on d.po_id=po.id and d.plan->>'route'='site' and d.state<>'cancelled'
    join private.delivery_receipts h on h.delivery_id=d.id
    join private.delivery_receipt_versions v on v.delivery_id=h.delivery_id and v.revision=h.revision
    cross join lateral jsonb_array_elements(v.snapshot->'lines') line
    join private.purchasing_claims claim on claim.record_id=po.id and claim.line_id=(line->>'lineId')::uuid
    where po.request_id=any(targets)
    union all
    select tline.item_id,(line->>'stockQuantity')::numeric,h.posted_at
    from private.transfers t
    join private.transfer_trips trip on trip.transfer_id=t.id and trip.route<>'site-warehouse' and trip.state<>'cancelled'
    join private.transfer_receipts h on h.trip_id=trip.id
    join private.transfer_receipt_versions v on v.trip_id=h.trip_id and v.revision=h.revision
    cross join lateral jsonb_array_elements(v.snapshot->'lines') line
    join private.transfer_lines tline on tline.transfer_id=t.id and tline.id=(line->>'lineId')::uuid
    where t.request_id=any(targets)
  ), quantities as (
    select item_id,sum(quantity) as accepted,sum(quantity) filter(where posted_at is not null) as posted
    from received group by item_id
  ), claims as (
    select c.item_id,
      sum(c.quantity) filter(where c.owner_kind='suitability') as hold,
      sum(c.quantity) filter(where c.owner_kind='award') as awarded,
      sum(c.quantity) filter(where c.owner_kind='purchase_order' and issued.po_id is null) as purchasing,
      sum(c.quantity) filter(where c.owner_kind='purchase_order' and issued.po_id is not null) as issued,
      sum(c.quantity) filter(where t.status='release_pending') as release_pending,
      sum(c.quantity) filter(where t.status='approved') as transfers,
      sum(c.quantity) as assigned
    from private.demand_claims c
    left join private.po_issuances issued on c.owner_kind='purchase_order' and issued.po_id=c.owner_id
    left join private.transfers t on c.owner_kind='transfer' and t.id=c.owner_id
    where c.request_id=any(targets)
    group by c.item_id
  )
  select target.id,i.id,i.line_order,i.material,i.quantity,i.unit,
    c.hold,c.awarded,c.purchasing,c.issued,c.release_pending,c.transfers,
    i.quantity-coalesce(c.assigned,0),q.accepted,q.posted
  from unnest(targets) as target(id)
  cross join lateral private.monitoring_request_items(target.id) i
  left join claims c on c.item_id=i.id
  left join quantities q on q.item_id=i.id
$$;

create function private.monitoring_progress_stage(total bigint, complete bigint, started boolean)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('state',case
    when total=0 then 'unavailable' when complete=total then 'complete'
    when started then 'partial' else 'not-started' end,'completeLines',complete)
$$;

create function private.monitoring_dashboard_progress(projects uuid[], include_closed boolean, ref_search text, requested_page integer)
returns jsonb language sql stable set search_path='' as $$
  with candidates as materialized (
    select r.id,r.ref,p.name as project,r.status,r.correction_kind,r.correction_state,r.created_at
    from public.material_requests r join public.projects p on p.id=r.project_id
    where r.project_id=any(projects)
      and (include_closed or r.status<>'rejected')
      and (ref_search='' or strpos(lower(r.ref),lower(ref_search))>0)
  ), stage_counts as (
    select f.request_id,count(*) as total,
      count(*) filter(where coalesce(f.issued,0)+coalesce(f.transfers,0)>=f.quantity) as sourced,
      count(*) filter(where f.accepted>=f.quantity) as received,
      count(*) filter(where f.posted>=f.quantity) as posted,
      bool_or(coalesce(f.issued,0)+coalesce(f.transfers,0)>0) as sourcing_started,
      bool_or(f.accepted>0) as receiving_started,bool_or(f.posted>0) as posting_started
    from private.monitoring_line_facts(array(select id from candidates)) f
    where f.quantity>0
    group by f.request_id
  ), eligible as materialized (
    select c.*,coalesce(s.total,0) as total,
      private.monitoring_progress_stage(coalesce(s.total,0),coalesce(s.sourced,0),s.sourcing_started) as sourcing,
      private.monitoring_progress_stage(coalesce(s.total,0),coalesce(s.received,0),s.receiving_started) as receipt,
      private.monitoring_progress_stage(coalesce(s.total,0),coalesce(s.posted,0),s.posting_started) as posting
    from candidates c left join stage_counts s on s.request_id=c.id
    where include_closed or c.status<>'approved' or c.correction_state is not null
      or s.total is null or s.posted<s.total
  ), tally as (
    select count(*) as total,greatest(1,(count(*)+24)/25) as pages from eligible
  ), paging as (
    select total,pages,least(pages,requested_page) as page from tally
  ), page_rows as (
    select * from eligible order by created_at desc,id
    limit 25 offset (select (page-1)*25 from paging)
  )
  select jsonb_build_object('total',total,'pages',pages,'page',page,'rows',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',p.id,'ref',p.ref,'project',p.project,'status',p.status,
      'correctionKind',p.correction_kind,'correctionState',p.correction_state,
      'totalLines',p.total,'sourcing',p.sourcing,'receipt',p.receipt,'posting',p.posting)
      order by p.created_at desc,p.id)
    from page_rows p),'[]'::jsonb))
  from paging
$$;

create or replace function private.monitoring_lifecycle(target uuid, project uuid, site boolean)
returns jsonb language sql stable set search_path='' as $$
  with shipments as materialized (
    select * from private.monitoring_shipments(array[project]) s where s.request_id=target
  ), demand as materialized (
    select * from private.monitoring_line_facts(array[target])
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
      'unassigned',trim_scale(d.unassigned)::text,'accepted',trim_scale(coalesce(d.accepted,0))::text,
      'posted',trim_scale(coalesce(d.posted,0))::text) order by d.line_order,d.id)
      from demand d),'[]'),
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

create or replace function public.monitoring_read(viewer jsonb, mode text, filters jsonb)
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
  if coalesce(mode,'') not in ('bell','dashboard','dashboardProgress','lifecycle','reports','consumption')
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
  if mode='dashboardProgress' then
    if coalesce(filters->>'status','active') not in ('active','all')
      or coalesce(filters->>'page','1') !~ '^[1-9][0-9]{0,7}$'
      or length(coalesce(filters->>'search',''))>128 then
      raise exception 'Invalid request progress filters' using errcode='22023';
    end if;
    return private.monitoring_dashboard_progress(visible,coalesce(filters->>'status','active')='all',
      btrim(coalesce(filters->>'search','')),(coalesce(filters->>'page','1'))::integer);
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

revoke all on function private.monitoring_line_facts(uuid[]),private.monitoring_progress_stage(bigint,bigint,boolean),
  private.monitoring_dashboard_progress(uuid[],boolean,text,integer),public.monitoring_read(jsonb,text,jsonb)
from public,anon,authenticated,service_role;
grant execute on function public.monitoring_read(jsonb,text,jsonb) to service_role;
