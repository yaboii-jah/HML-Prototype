create function private.project_document_folder_open(actor jsonb, target_project uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare folder text;
begin
  perform private.project_actor(actor, true);
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

create function public.project_document_folder_open(actor jsonb, target_project uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select private.project_document_folder_open(actor,target_project)
$$;

revoke all on function private.project_document_folder_open(jsonb,uuid),
  public.project_document_folder_open(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function private.project_document_folder_open(jsonb,uuid),
  public.project_document_folder_open(jsonb,uuid) to service_role;
