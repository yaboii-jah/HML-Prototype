import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

/** Isolated Drive protocol double. Never accepts or forwards a hosted URL. */
export async function fakeDrive() {
  const root = 'disposable-company-root';
  const files = new Map([[root, { id: root, name: 'Disposable company root', mimeType: 'application/vnd.google-apps.folder', parents: [], trashed: false, capabilities: { canAddChildren: true }, appProperties: {} }]]);
  const sessions = new Map();
  const faults = { loseFinalResponse: false, failCreateAfterCommit: false, pauseUploads: false };
  let origin, calls = 0;
  const server = createServer(async (req, res) => {
    try {
      calls++;
      if (req.headers.authorization !== 'Bearer disposable-drive-token') { res.writeHead(401).end(); return; }
      const url = new URL(req.url, origin);
      const chunks = [];
      let length = 0;
      for await (const chunk of req) { length += chunk.length; if (length > 4 * 1024 * 1024) throw Error('Fake request too large'); chunks.push(chunk); }
      const body = Buffer.concat(chunks);
      const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
      if (url.pathname.endsWith('/generateIds')) { json({ ids: ['drive-' + randomUUID()] }); return; }
      if (url.pathname === '/upload/drive/v3/files' && req.method === 'POST') {
        const data = JSON.parse(body), id = randomUUID();
        if (files.has(data.id)) { json({}, 409); return; }
        sessions.set(id, { data, bytes: Buffer.alloc(0), total: Number(req.headers['x-upload-content-length']) });
        res.writeHead(200, { Location: `${origin}/upload/drive/v3/files?uploadType=resumable&upload_id=${id}` }).end(); return;
      }
      if (url.pathname === '/upload/drive/v3/files' && req.method === 'PUT') {
        const session = sessions.get(url.searchParams.get('upload_id'));
        if (!session) { json({}, 404); return; }
        const range = req.headers['content-range'];
        if (!String(range).startsWith('bytes */')) {
          if (faults.pauseUploads) { json({}, 503); return; }
          const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
          if (!match || Number(match[1]) !== session.bytes.length || Number(match[2]) + 1 !== session.bytes.length + body.length || Number(match[3]) !== session.total) { json({}, 400); return; }
          session.bytes = Buffer.concat([session.bytes, body]);
        }
        if (session.bytes.length === session.total) {
          const file = { ...session.data, size: String(session.total), body: session.bytes, trashed: false };
          files.set(file.id, file);
          if (faults.loseFinalResponse) { faults.loseFinalResponse = false; req.socket.destroy(); return; }
          json(file); return;
        }
        res.writeHead(308, session.bytes.length ? { Range: `bytes=0-${session.bytes.length - 1}` } : {}).end(); return;
      }
      if (url.pathname === '/drive/v3/files' && req.method === 'POST') {
        const data = JSON.parse(body);
        if (files.has(data.id)) { json({}, 409); return; }
        const file = { ...data, trashed: false, capabilities: { canAddChildren: true } };
        files.set(file.id, file);
        if (faults.failCreateAfterCommit) { faults.failCreateAfterCommit = false; req.socket.destroy(); return; }
        json(file); return;
      }
      const id = decodeURIComponent(url.pathname.split('/').at(-1)), file = files.get(id);
      if (!file) { json({}, 404); return; }
      if (req.method === 'PATCH') { Object.assign(file, JSON.parse(body)); json(file); return; }
      if (req.method === 'GET' && url.searchParams.get('alt') === 'media') {
        if (!file.body || file.trashed) { json({}, 404); return; }
        const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '');
        const bytes = range ? file.body.subarray(Number(range[1]), Number(range[2]) + 1) : file.body;
        res.writeHead(range ? 206 : 200, { 'Content-Type': 'application/pdf', 'Content-Length': bytes.length, ...(range ? { 'Content-Range': `bytes ${range[1]}-${range[2]}/${file.body.length}` } : {}) }); res.end(bytes); return;
      }
      const { body: omitted, ...publicMetadata } = file;
      void omitted;
      json(publicMetadata);
    } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { root, origin, files, sessions, faults, get calls() { return calls; }, close: () => new Promise(done => { server.closeAllConnections(); server.close(done); }) };
}
