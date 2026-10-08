#!/usr/bin/env node
// Keeps docs/ findable: every document carries the frontmatter the index and the
// agents rely on, every document is listed in docs/index.md, and every link in
// the index points at a document that exists. Images and other non-Markdown
// files are attachments of a document and need neither.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../docs/', import.meta.url).pathname;
const errors = [];

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.md') ? [join(dir, e.name)] : [],
  );

const docs = walk(root)
  .map((f) => relative(root, f))
  .filter((f) => f !== 'index.md');
const index = readFileSync(join(root, 'index.md'), 'utf8');
const linked = new Set([...index.matchAll(/\]\(([^)#]+\.md)(#[^)]*)?\)/g)].map((m) => m[1]));

for (const doc of docs) {
  const text = readFileSync(join(root, doc), 'utf8');
  const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) {
    errors.push(`${doc}: no frontmatter`);
  } else {
    for (const key of ['summary', 'updated', 'source']) {
      if (!new RegExp(`^${key}: \\S`, 'm').test(fm[1])) errors.push(`${doc}: frontmatter lacks "${key}"`);
    }
    const updated = fm[1].match(/^updated: (.*)$/m)?.[1];
    if (updated && !/^\d{4}-\d{2}-\d{2}$/.test(updated.trim())) errors.push(`${doc}: "updated" is not YYYY-MM-DD`);
  }
  if (!linked.has(doc)) errors.push(`${doc}: not listed in docs/index.md`);
}
for (const link of linked) {
  if (!existsSync(join(root, link))) errors.push(`index.md links ${link}, which does not exist`);
}

if (errors.length) {
  console.error(errors.map((e) => `docs/${e}`).join('\n'));
  process.exit(1);
}
console.log(`docs: ${docs.length} documents, all indexed`);
