#!/usr/bin/env node
// Checks every i18n/<code>.json against i18n/en.json: same keys (nested), same array lengths, same {placeholders}.
// Usage: node scripts/check-i18n.mjs [dir]   (dir defaults to the repo's i18n/). Exits 1 on any problem.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'i18n'));
const problems = [];
const read = (file) => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); } catch (e) { problems.push(`${file}: not valid JSON (${e.message})`); return undefined; }
};
const kind = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
const holes = (s) => new Set(s.match(/\{\w+\}/g) || []);

function compare(en, tr, at, file) {
  const where = `${file}: ${at || '(root)'}`;
  if (kind(en) !== kind(tr)) return problems.push(`${where} is ${kind(tr)}, expected ${kind(en)}`);
  if (Array.isArray(en)) {
    if (en.length !== tr.length) problems.push(`${where} has ${tr.length} items, expected ${en.length}`);
    en.forEach((v, i) => i < tr.length && compare(v, tr[i], `${at}[${i}]`, file));
  } else if (kind(en) === 'object') {
    for (const k of Object.keys(en)) if (!Object.hasOwn(tr, k)) problems.push(`${file}: missing key ${at ? at + '.' : ''}${k}`);
    for (const k of Object.keys(tr)) if (!Object.hasOwn(en, k)) problems.push(`${file}: extra key ${at ? at + '.' : ''}${k}`);
    for (const k of Object.keys(en)) if (Object.hasOwn(tr, k)) compare(en[k], tr[k], at ? `${at}.${k}` : k, file);
  } else if (typeof en === 'string') {
    const want = holes(en), got = holes(tr);
    for (const h of want) if (!got.has(h)) problems.push(`${where} is missing placeholder ${h}`);
    for (const h of got) if (!want.has(h)) problems.push(`${where} has unknown placeholder ${h}`);
    if (!tr.trim() && en.trim()) problems.push(`${where} is empty`);
  }
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
if (!files.includes('en.json')) problems.push(`${dir}: en.json not found`);
const en = files.includes('en.json') ? read('en.json') : undefined;
if (en !== undefined) for (const f of files) {
  if (f === 'en.json') continue;
  if (!/^[a-z]{2,3}\.json$/.test(f)) { problems.push(`${f}: file name must be a 2-3 letter language code`); continue; }
  const tr = read(f);
  if (tr !== undefined) compare(en, tr, '', f);
}

if (problems.length) {
  console.error(`i18n check failed (${problems.length} problem${problems.length > 1 ? 's' : ''}):\n  ` + problems.join('\n  '));
  process.exit(1);
}
console.log(`i18n check passed: ${files.length} file(s) match en.json`);
