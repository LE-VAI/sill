// Brand gate: no retired Designesy colour anywhere in this repo (Designesy brand ledger D44, D46).
// HEX and RGB are copied from designesy-org apps/site/scripts/retired-literals.json at 97b1db08.
// 5d7bff, 2a4cd8 and 2a4fe0 are the pre-v1 access and key blues this repo's demos used before identity v1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HEX = [
  '0133cb', 'fecc34', 'fecc35', '2c50ec', '5b7cff', '3a63f5', '8aa0ff', 'ea580c', 'fb923c', 'f97316', '3358e8',
  '5d7bff', '2a4cd8', '2a4fe0',
];
const RGB = [[1, 51, 203], [51, 88, 232]];
const TEXT = new Set(['.css', '.js', '.mjs', '.ts', '.html', '.md', '.json', '.svg', '.yml']);
const SKIP = new Set(['.git', 'node_modules']);
const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(SELF, '..', '..');

// A retired hex, alone or with an alpha pair, never as the start of a longer hex.
const hexRe = new RegExp(`#(?:${HEX.join('|')})(?:[0-9a-f]{2})?(?![0-9a-f])`, 'i');
const rgbRes = RGB.map(([r, g, b]) => new RegExp(`rgba?\\(\\s*${r}\\s*[,\\s]\\s*${g}\\s*[,\\s]\\s*${b}(?!\\d)`, 'i'));
const hit = (s) => hexRe.test(s) || rgbRes.some((re) => re.test(s));

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (TEXT.has(extname(name))) yield p;
  }
}

test('the patterns catch what they must, and nothing else', () => {
  for (const s of ['#0133CB', '#0133cb24', '#3358e8', 'rgb(1,51,203)', 'rgba(1, 51, 203, .2)', 'rgb(1 51 203 / .4)', '#5d7bff']) {
    assert.ok(hit(s), `should match: ${s}`);
  }
  for (const s of ['#0A94FF', '#016ABB', '#36A7FF', '#0133cbff00', 'rgb(10,148,255)', 'rgb(1,51,2030)']) {
    assert.ok(!hit(s), `should not match: ${s}`);
  }
});

test('no retired brand colour in any text file', () => {
  const found = [];
  for (const f of files(ROOT)) {
    if (f === SELF) continue;
    readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (hit(line)) found.push(`${f.slice(ROOT.length + 1)}:${i + 1}`);
    });
  }
  assert.deepEqual(found, []);
});
