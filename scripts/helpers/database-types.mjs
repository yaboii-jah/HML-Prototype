import { introspect, parseGeneratorMetadata } from '@supabase/postgrest-typegen';
import { generateTypescript, sortGeneratorMetadata } from '@supabase/postgrest-typegen/generation';

// The CLI's generated text includes platform-dependent newlines and trailing spaces.
export function normalizeDatabaseTypes(source) {
  return source.replaceAll('\r\n', '\n').replace(/[\t ]+$/gm, '').trimStart().trimEnd() + '\n';
}

// Pin one owning generator for both catalog transports; the hosted CLI endpoint uses a different version.
export async function generateDatabaseTypes(query) {
  const metadata = await introspect({ query: async sql => {
    const rows = await query(sql);
    if (!Array.isArray(rows) || rows.some(row => row === null || typeof row !== 'object' || Array.isArray(row))) {
      throw new Error('Database introspection returned invalid rows.');
    }
    return { rows };
  } }, { includedSchemas: ['public', 'private'] });
  const source = await generateTypescript(sortGeneratorMetadata(parseGeneratorMetadata(metadata)), {
    detectOneToOneRelationships: true,
    format: async code => code,
  });
  return normalizeDatabaseTypes(source);
}
