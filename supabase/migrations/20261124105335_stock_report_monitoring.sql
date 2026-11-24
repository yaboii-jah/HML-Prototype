alter function private.monitoring_queue(uuid[],text,uuid,boolean) rename to monitoring_queue_before_stock_reports;

create function private.monitoring_queue(projects uuid[], role_name text, caller uuid, ready_only boolean)
returns jsonb language plpgsql stable set search_path='' as $$
declare queue jsonb; reports jsonb; pending_count bigint;
begin
  queue:=private.monitoring_queue_before_stock_reports(projects,role_name,caller,ready_only);
  if role_name is distinct from 'Accounting' then return queue; end if;

  select count(*), case when ready_only then '[]'::jsonb else coalesce(jsonb_agg(jsonb_build_object(
    'key',r.id||':Review unrecorded stock','projectId',r.project_id,'ref',r.description,
    'href','/inventory?view=stock-reports&reportId='||r.id,'label','Review unrecorded stock',
    'blocker',null,'at',r.reported_at,'flag',null) order by r.reported_at,r.id),'[]') end
  into pending_count,reports
  from private.stock_reports r where r.project_id=any(projects) and r.status='pending';

  if pending_count=0 then return queue; end if;
  return jsonb_build_object('count',(queue->>'count')::bigint+pending_count,
    'actions',(select coalesce(jsonb_agg(item order by (item->>'flag' is null),
      (item->>'at')::timestamptz nulls last,position),'[]')
      from jsonb_array_elements(queue->'actions'||reports) with ordinality as actions(item,position)));
end $$;

revoke all on function private.monitoring_queue(uuid[],text,uuid,boolean) from public,anon,authenticated,service_role;
