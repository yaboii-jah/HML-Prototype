import { requireStaging, STAGING_REF } from './supabase-target.mjs';

/** Read-only retained-state evidence. No Auth passwords, tokens or raw business
 * rows are returned. Application rows are compared using deterministic hashes. */
export async function stagingSnapshot({ includeProjectOperations = true, includeDocuments = true } = {}) {
  requireStaging(process.env);
  const tables = [
    ['profiles', 'public.profiles', 'user_id'], ['grants', 'public.role_grants', 'user_id,role'],
    ['assignments', 'public.project_assignments', 'user_id,project_id'], ['projects', 'public.projects', 'id'],
    ['scopes', 'public.scopes', 'id'], ['projectBudgets', 'public.project_budgets', 'project_id'],
    ['scopeBudgets', 'public.scope_budgets', 'scope_id'], ['bindings', 'private.session_bindings', 'session_id'],
    ['requests', 'public.material_requests', 'id'], ['requestItems', 'public.material_request_items', 'id'], ['requestOperations', 'private.request_operations', 'id'], ['counters', 'private.document_counters', 'project_id,series'],
    ['audits', 'private.audit_events', 'id'], ['accountOperations', 'private.account_operations', 'id'],
  ];
  // During the 4.2 migration, compare all pre-existing rows before/after DDL.
  // Post-migration acceptance retains its default coverage of every new table.
  if (includeDocuments) tables.push(
    ['documentFolders', 'private.project_document_folders', 'id'], ['folderOwners', 'private.document_folder_owners', 'folder_id'],
    ['documentState', 'private.request_document_state', 'request_id'], ['documents', 'private.request_documents', 'id'],
    ['uploads', 'private.document_uploads', 'id'], ['documentJobs', 'private.document_jobs', 'id'], ['documentOperations', 'private.document_operations', 'id'],
    ['archiveSnapshots', 'private.mrf_archive_snapshots', 'id'], ['archives', 'private.mrf_archives', 'snapshot_id'],
    ['mrfSubmissions', 'private.mrf_submissions', 'id'], ['mrfReviews', 'private.mrf_review_events', 'id'],
    ['mrfReferences', 'private.mrf_downstream_references', 'request_id,kind,record_id'], ['mrfArchiveFiles', 'private.mrf_archive_files', 'id'],
  );
  if (includeProjectOperations) tables.push(['projectOperations', 'private.project_operations', 'id']);
  const hashes = tables.map(([name, table, order]) => `'${name}',(select jsonb_build_object('count',count(*),'digest',md5(coalesce(jsonb_agg(to_jsonb(t) order by ${order})::text,'[]'))) from ${table} t)`).join(',');
  const query = `select jsonb_build_object('records',jsonb_build_object(${hashes}),
    'authCounts',jsonb_build_array((select count(*) from auth.users),(select count(*) from auth.sessions)),
    'profiles',(select coalesce(jsonb_agg(jsonb_build_array(user_id,version::text,access_revision::text,is_active) order by user_id),'[]'::jsonb) from public.profiles),
    'guard',(select revision::text from private.account_guard where id)) as snapshot;`;
  const response = await fetch(`https://api.supabase.com/v1/projects/${STAGING_REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, read_only: true }), signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(`Staging retained-state inspection failed (${response.status}).`);
  const rows = await response.json();
  if (!rows[0]?.snapshot) throw Error('Invalid staging snapshot.');
  return rows[0].snapshot;
}
