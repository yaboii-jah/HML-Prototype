import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const globRequire = createRequire(require.resolve('micromatch'));
const picomatch = globRequire('picomatch');

test('the reviewed security fork remains pinned for transitive glob consumers', () => {
  const metadata = globRequire('picomatch/package.json');
  assert.equal(metadata.name, '@ryotsu/picomatch');
  assert.equal(metadata.version, '4.0.7-a');
});

test('single-branch repeated extglobs finish within a bounded subprocess', () => {
  // Each case has its own deadline, so a regression cannot hang the test runner.
  for (const pattern of ['+(*)', '+(*a)', '*(*)', '*(*a)', '+(@(a|aa)*)']) {
    const script = `const {createRequire}=require('node:module');const pm=createRequire(require.resolve('micromatch'))('picomatch');const match=pm(${JSON.stringify(pattern)});for(let n=24;n<=128;n+=8)match('a'.repeat(n)+'!');`;
    const result = spawnSync(process.execPath, ['-e', script], { cwd:process.cwd(), timeout:2000, windowsHide:true });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${pattern}: ${result.stderr}`);
  }
});

test('file-selection APIs retain ordinary glob, brace, extglob and dotfile behavior', () => {
  const cases = [
    ['src/**/*.ts', 'src/domain/a.ts', true],
    ['src/**/*.ts', 'src/domain/a.js', false],
    ['**/*.{js,mjs}', 'scripts/check.mjs', true],
    ['**/!(*.test).js', 'src/page.js', true],
    ['**/!(*.test).js', 'src/page.test.js', false],
    ['+(a|b)', 'abba', true],
    ['+(a|b)', 'abc', false],
    ['*', '.env', false],
  ];
  for (const [pattern, value, expected] of cases) assert.equal(picomatch(pattern)(value), expected, `${pattern}: ${value}`);
  assert.equal(picomatch.scan('src/**/*.ts').isGlob, true);
  assert.equal(picomatch.makeRe('*.ts').test('index.ts'), true);
  assert.ok(picomatch.parse('src/**/*.ts').output);
});
