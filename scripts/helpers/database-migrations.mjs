import { createHash } from 'node:crypto';

export function migrationHash(files) {
  const hash = createHash('sha256');
  for (const { name, sql } of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    hash.update(name).update('\0').update(sql.replaceAll('\r\n', '\n')).update('\0');
  }
  return hash.digest('hex');
}
