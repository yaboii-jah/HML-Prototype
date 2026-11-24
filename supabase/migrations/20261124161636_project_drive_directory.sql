create or replace function private.project_document_folder_open(actor jsonb, target_project uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare folder text;
begin
  perform private.project_actor(actor);
  if actor->>'activeRole' = 'Site Personnel' then
    raise exception 'Project folder access required' using errcode='42501';
  end if;

  select f.folder_id into folder
  from public.projects p
  left join private.project_document_folders f on f.project_id=p.id and f.current
  where p.id=target_project and private.request_project_allowed(actor,p.id);

  if not found then
    raise exception 'Project access required' using errcode='42501';
  end if;

  return jsonb_build_object('folderId',folder);
end;
$$;

create function private.project_drive_directory(actor jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.project_actor(actor);
  if actor->>'activeRole' = 'Site Personnel' then
    raise exception 'Project folder access required' using errcode='42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'code',p.document_code)
      order by lower(p.name),p.id)
    from public.projects p
    join private.project_document_folders f on f.project_id=p.id and f.current
    where private.request_project_allowed(actor,p.id)
  ),'[]'::jsonb);
end;
$$;

create function public.project_drive_directory(actor jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.project_drive_directory(actor)
$$;

revoke all on function private.project_drive_directory(jsonb),
  public.project_drive_directory(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.project_drive_directory(jsonb),
  public.project_drive_directory(jsonb) to service_role;
