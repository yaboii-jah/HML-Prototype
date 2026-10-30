import { request } from 'node:http';

// CLI 2.122 does not expose GoTrue's current-password setting. Recreate only
// this run's Auth container with the same config/network and that flag enabled.
// Keep its transient secrets in memory, never in command output or artifacts.
export async function configureDisposableAuth(project, network) {
  if (process.platform !== 'linux' || process.env.GITHUB_ACTIONS !== 'true'
    || !/^\d+$/.test(process.env.GITHUB_RUN_ID ?? '')
    || project !== `constructsync-ci-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`
    || network !== `${project}-network`) throw Error('Refusing a non-owned Auth container');
  const name = `supabase_auth_${project}`;
  const docker = (method, path, body) => new Promise((done, reject) => {
    const req = request({ socketPath: '/var/run/docker.sock', path, method, headers: { 'Content-Type': 'application/json' }, timeout: 30000 }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 300) return reject(Error(`Disposable Auth configuration failed (${res.statusCode})`));
        try { done(text ? JSON.parse(text) : null); } catch { reject(Error('Invalid Docker configuration response')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(Error('Docker configuration timed out')));
    req.end(body ? JSON.stringify(body) : undefined);
  });
  const current = await docker('GET', `/containers/${name}/json`);
  if (current.Name !== '/' + name || Object.keys(current.NetworkSettings.Networks).length !== 1 || !current.NetworkSettings.Networks[network]) throw Error('Auth container ownership/network mismatch');
  const flag = 'GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD';
  const replacement = {
    ...current.Config,
    Env: [...current.Config.Env.filter(value => !value.startsWith(flag + '=')), flag + '=true'],
    HostConfig: current.HostConfig,
    NetworkingConfig: { EndpointsConfig: { [network]: { Aliases: current.NetworkSettings.Networks[network].Aliases } } },
  };
  await docker('POST', `/containers/${name}/stop?t=5`);
  await docker('DELETE', `/containers/${name}`);
  await docker('POST', `/containers/create?name=${name}`, replacement);
  await docker('POST', `/containers/${name}/start`);
  const configured = await docker('GET', `/containers/${name}/json`);
  if (!configured.Config.Env.includes(flag + '=true')) throw Error('Auth password protection flag was not applied');
}
