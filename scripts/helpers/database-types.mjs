// The CLI's generated text includes platform-dependent newlines and trailing spaces.
export function normalizeDatabaseTypes(source) {
  return source.replaceAll('\r\n', '\n').replace(/[\t ]+$/gm, '').trimStart().trimEnd() + '\n';
}
