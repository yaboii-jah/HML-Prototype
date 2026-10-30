import { randomUUID } from 'node:crypto';

/** The caller owns the private checkpoint; no password or API secret is stored. */
export async function bootstrapAdministrator({ client, load, save, name, email, password }) {
  if (!name.trim() || name.trim().length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 8 || password.length > 128) {
    throw new Error('Provide a name, valid email, and an 8–128 character password.');
  }
  let checkpoint = await load();
  if (checkpoint && (checkpoint.email !== email.toLowerCase() || checkpoint.name !== name.trim())) {
    throw new Error('A different bootstrap is pending. Use its original name and email; do not replace its checkpoint.');
  }
  if (!checkpoint) {
    const existing = await client.from('profiles').select('user_id', { count: 'exact', head: true });
    if (existing.error) throw new Error('Workspace initialization could not be checked.');
    if (existing.count !== 0) throw new Error('Workspace already initialized. Use account administration.');
    checkpoint = { requestId: randomUUID(), email: email.toLowerCase(), name: name.trim(), userId: null };
    await save(checkpoint);
  }
  if (!checkpoint.userId) {
    // Recover an Auth success whose response/checkpoint save was interrupted.
    for (let page = 1; page <= 100; page++) {
      const result = await client.auth.admin.listUsers({ page, perPage: 100 });
      if (result.error) throw new Error('Pending identity could not be checked. Rerun the same command.');
      const owned = result.data.users.find(user => user.app_metadata?.bootstrap_request_id === checkpoint.requestId && user.email?.toLowerCase() === checkpoint.email);
      if (owned) { checkpoint.userId = owned.id; break; }
      if (result.data.users.length < 100) break;
      if (page === 100) throw new Error('Identity search limit reached. No identity was adopted or created.');
    }
    if (!checkpoint.userId) {
      const result = await client.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { bootstrap_request_id: checkpoint.requestId } });
      if (result.error || !result.data.user) throw new Error('Identity creation could not finish. Rerun the same command to recover a partial success.');
      checkpoint.userId = result.data.user.id;
    }
    await save(checkpoint);
  }
  const verified = await client.auth.admin.getUserById(checkpoint.userId);
  if (verified.error || verified.data.user?.app_metadata?.bootstrap_request_id !== checkpoint.requestId || verified.data.user.email?.toLowerCase() !== checkpoint.email) {
    throw new Error('The checkpoint does not identify this bootstrap’s Auth user. No account was changed.');
  }
  const result = await client.rpc('auth_bootstrap_administrator', {
    target_user: checkpoint.userId, display_name: checkpoint.name, request_id: checkpoint.requestId,
  });
  if (result.error) {
    if (result.error.code === '23514') {
      // A competing bootstrap won. Delete only our marked, unreferenced identity.
      const profile = await client.from('profiles').select('user_id').eq('user_id', checkpoint.userId).maybeSingle();
      if (!profile.error && !profile.data) {
        const removed = await client.auth.admin.deleteUser(checkpoint.userId);
        if (removed.error) throw new Error('Another bootstrap initialized the workspace. Run-owned identity cleanup needs attention.');
      }
      throw new Error('Workspace already initialized. No additional Administrator was granted.');
    }
    throw new Error('Administrator provisioning could not finish. Keep the checkpoint and rerun the same command.');
  }
  checkpoint.complete = true;
  await save(checkpoint);
  return { userId: checkpoint.userId, requestId: checkpoint.requestId };
}
