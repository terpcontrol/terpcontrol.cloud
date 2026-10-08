#!/usr/bin/env node
// Keeps out of this public repository what must never be public. Runs as a Stop hook and
// before `git push` / `gh pr create|edit|comment`: it scans what this branch adds against the
// base branch - changed and untracked files, commit messages, and the command about to run - for
// company knowledge (which belongs in the private terpcontrol.com repository), secrets and
// details about servers. The patterns are a net, not a judge: a hit sends the agent back with the
// lines and the agent decides. Each hit is reported once per worktree, so a harmless one costs a
// single round trip and nothing loops.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join } from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const dir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const git = (...args) => {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
};

const preToolUse = input.hook_event_name === 'PreToolUse';
const command = preToolUse ? String(input.tool_input?.command ?? '') : '';
if (preToolUse && !/\bgit\s+push\b|\bgh\s+pr\s+(create|edit|comment)\b/.test(command)) process.exit(0);

// Prose is where company knowledge gets written down; configuration and scripts are where
// server details end up. Code is only checked for amounts of money and secrets.
const prose = (f) => /\.(md|txt)$/i.test(f) || f.startsWith('docs/') || f.startsWith('commit ') || f === 'command';
const config = (f) => prose(f) || /(\.(sh|ya?ml|json|conf|ini|toml)|^\.env[^/]*|Dockerfile[^/]*)$/i.test(f);
const all = () => true;

const checks = [
  ['company knowledge: an amount of money', /\d\s?(€|EUR\b|Euro\b)|€\s?\d/i, all],
  [
    'company knowledge: a business term',
    /\b(Marge\w*|Gewinnmarge|Rohertrag|Deckungsbeitrag|profit margin|gross margin|Einkaufspreis\w*|EK-Preis\w*|Stückkosten|Herstellkosten|unit costs?|landed costs?|Lieferant\w*|Zulieferer|suppliers?|Großhändler\w*|wholesal\w*|Händler\w*|resellers?|distributors?|Umsatz|Umsätze\w*|revenue|Absatz\w*|Verkaufszahl\w*|units sold|break-even|Kunde\w*|Kundin\w*|customers?|Wettbewerb\w*|Mitbewerber\w*|competitors?|Marktanalyse\w*|Marktanteil\w*|market share|market size|Zielmarkt\w*|target market|Preis\w*|prices?|pricing|price points?|sales|margins? of|markups?|Rabatt\w*|discounts?|UVP|MSRP|Roadmap|Geschäftsmodell\w*|business model|business plan|Businessplan|Investor\w*|Finanzierung|KCanG|Shopify|dekompil\w*|decompil\w*)\b/i,
    prose,
  ],
  ['secret', /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(ghp_|gho_|github_pat_|sk-ant-|xox[abprs]-)[\w-]{10,}|\bAKIA[0-9A-Z]{16}\b/, all],
  [
    'secret: a credential value',
    /\b(pass(word|wort|wd)?|pwd|secret|token|api[_-]?key|access[_-]?key|psk)\b["']?\s*[:=]\s*["']?(?!\$|<|CHANGEME)[^\s"'`,;)]{8,}/i,
    config,
  ],
  [
    'server detail: an IP address',
    /\b(?!127\.|0\.0\.0\.0\b|255\.255\.255\.255\b|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/,
    config,
  ],
  ['server detail: an e-mail address', /[\w.+-]+@(?!example\.|users\.noreply\.github\.com|anthropic\.com\b|terpcontrol\.|\d+\.\d+\.\d+\.\d+)[\w-]+(\.[\w-]+)+/, config],
  [
    'server detail: ssh, scp or a server path',
    /\b(ssh|scp)\s+-?\w|(^|[\s'"`(=])\/(srv|mnt|var\/www|volume\d+|home\/(?!user\/|runner\/|node\/)[a-z][\w.-]*)\/[\w.-]/,
    config,
  ],
  ['server detail: a host name', /\b(?!www\.)[a-z0-9-]+\.terpcontrol\.(com|cloud|shop)\b/i, config],
];

// Names that would themselves give something away (a server's host name, how its paths look) stay out of the
// repository: each line of ~/.claude/terpcontrol-guard-patterns is one more regular expression, checked everywhere.
const localPatterns = join(process.env.HOME ?? '', '.claude', 'terpcontrol-guard-patterns');
if (existsSync(localPatterns)) {
  for (const line of readFileSync(localPatterns, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)) {
    checks.push(['server detail: a locally listed name', new RegExp(line, 'i'), all]);
  }
}

const remote = git('symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD').trim() || 'refs/remotes/origin/master';
const base = git('merge-base', 'HEAD', remote).trim() || 'HEAD';
const skip = (f) => /(^|\/)(package-lock\.json|[^/]*\.min\.[a-z]+|dist\/.*)$/.test(f);

// Every added line, with where it is: committed or not, against the merge base.
const lines = [];
let file = '';
let at = 0;
for (const l of git('-c', 'core.quotePath=false', 'diff', '--no-color', '--unified=0', base).split('\n')) {
  if (l.startsWith('+++ ')) file = l.slice(6);
  else if (l.startsWith('@@')) at = Number(l.match(/\+(\d+)/)?.[1] ?? 0);
  else if (l.startsWith('+') && file && !skip(file)) lines.push([file, at++, l.slice(1)]);
}
for (const f of git('-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)) {
  if (skip(f)) continue;
  const text = readFileSync(join(dir, f), 'utf8');
  if (!text.includes('\0') && text.length < 2_000_000) text.split('\n').forEach((t, i) => lines.push([f, i + 1, t]));
}
for (const c of git('log', '--format=%h%x00%B%x01', `${base}..HEAD`).split('\x01')) {
  const [hash, body = ''] = c.trim().split('\0');
  if (hash) body.split('\n').forEach((t, i) => lines.push([`commit ${hash}`, i + 1, t]));
}
// A command that works in the private checkout (the remember skill's $COM and $WT) commits and pushes there, where
// company knowledge belongs; only what lands here is this guard's business.
if (!/\$\{?(COM|WT|TERPCONTROL_COM_DIR)\b/.test(command)) command.split('\n').forEach((t, i) => lines.push(['command', i + 1, t]));

const seenPath = git('rev-parse', '--git-path', 'terpcontrol-guard-reported').trim();
const seenFile = seenPath && (isAbsolute(seenPath) ? seenPath : join(dir, seenPath));
const seen = new Set(seenFile && existsSync(seenFile) ? readFileSync(seenFile, 'utf8').split('\n') : []);
const hits = [];
for (const [f, n, text] of lines) {
  for (const [label, re, applies] of checks) {
    if (!applies(f) || !re.test(text)) continue;
    const key = createHash('sha1').update(`${label}\0${f}\0${text.trim()}`).digest('hex');
    if (!seen.has(key)) hits.push([key, `- ${f}:${n} (${label}): ${text.trim().slice(0, 160)}`]);
  }
}
if (!hits.length) process.exit(0);
if (seenFile) appendFileSync(seenFile, hits.map(([key]) => key).join('\n') + '\n');

const reason = [
  'This branch adds lines that may not belong in this public repository:',
  ...hits.slice(0, 25).map(([, line]) => line),
  ...(hits.length > 25 ? [`- ... and ${hits.length - 25} more`] : []),
  'Company knowledge (prices, costs, margins, suppliers, customers, sales, markets, strategy, legal, reverse ' +
    'engineering of purchased hardware) belongs in the private terpcontrol.com repository: move it there with the ' +
    'remember skill and remove it here. Secrets and server details (host names, IPs, paths, users, ports, versions) ' +
    'belong in no repository: remove them, and rewrite unpushed commits that carry them. A hit that is technical ' +
    'and harmless needs nothing; each hit is reported once.',
].join('\n');
console.log(
  JSON.stringify(
    preToolUse
      ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }
      : { decision: 'block', reason },
  ),
);
