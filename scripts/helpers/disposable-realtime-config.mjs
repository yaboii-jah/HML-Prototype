import { request } from 'node:http';
import { createHmac } from 'node:crypto';

/** Use the owned container's tenant API so its distributed cache is invalidated.
 * Its API signing secret and short-lived token never leave this process. */
export async function configureDisposableRealtime(project, network, tenant_id) {
  if (process.platform !== 'linux' || process.env.GITHUB_ACTIONS !== 'true'
    || !/^\d+$/.test(process.env.GITHUB_RUN_ID ?? '')
    || project !== `constructsync-ci-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`
    || network !== project + '-network' || !/^[a-zA-Z0-9_-]{1,80}$/.test(tenant_id)) {
    throw Error('Refusing a non-owned Realtime configuration');
  }
  const docker = (method, path, body) => new Promise((done, reject) => {
    const req = request({ socketPath: '/var/run/docker.sock', path, method, headers: { 'Content-Type': 'application/json' }, timeout: 30000 }, res => {
      let output = '';
      res.on('data', chunk => { output += chunk; });
      res.on('end', () => res.statusCode >= 300 ? reject(Error('Disposable Realtime API failed: ' + res.statusCode)) : done(output));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(Error('Disposable Realtime API timed out')));
    req.end(body ? JSON.stringify(body) : undefined);
  });
  const name = 'supabase_realtime_' + project;
  const container = JSON.parse(await docker('GET', '/containers/' + name + '/json'));
  if (container.Name !== '/' + name || Object.keys(container.NetworkSettings.Networks).length !== 1
    || !container.NetworkSettings.Networks[network]) throw Error('Realtime container ownership/network mismatch');
  const secret = container.Config.Env.find(value => value.startsWith('API_JWT_SECRET='))?.slice('API_JWT_SECRET='.length);
  if (!secret) throw Error('Disposable Realtime API signing secret missing');
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 60 });
  const token = unsigned + '.' + createHmac('sha256', secret).update(unsigned).digest('base64url');
  // The disposable stack keeps one bound session per test account, and every
  // committed change publishes an invalidation to each bound session. That
  // exceeds the tenant's default broadcast rate, so the owned tenant is raised
  // to carry the harness. Hosted tenants keep the provider default.
  const tenant = { private_only: true, max_events_per_second: 10000, max_concurrent_users: 1000 };
  const exec = JSON.parse(await docker('POST', '/containers/' + name + '/exec', {
    AttachStdout: true, AttachStderr: true, Tty: true,
    Cmd: ['curl', '--silent', '--show-error', '--fail', '--max-time', '20', '-X', 'PUT',
      'http://127.0.0.1:4000/api/tenants/' + tenant_id, '-H', 'Authorization: Bearer ' + token,
      '-H', 'Content-Type: application/json', '-d', JSON.stringify({ tenant })],
  }));
  const output = await docker('POST', '/exec/' + exec.Id + '/start', { Detach: false, Tty: true });
  const result = JSON.parse(await docker('GET', '/exec/' + exec.Id + '/json'));
  if (result.ExitCode !== 0) throw Error('Disposable Realtime tenant update failed');
  const body = JSON.parse(output);
  if (body.data?.private_only !== true) throw Error('Disposable Realtime tenant private-only response mismatch');
  if (body.data?.max_events_per_second !== tenant.max_events_per_second)
    throw Error('Disposable Realtime tenant broadcast rate was not raised');
}
