#!/usr/bin/env node
// Stop hook: a person's decision or instruction must not end a turn unrecorded. The prompt hook beside it sees only
// the agent's last reply, so an agent that answered "OK" to "remember this" slips through it. This one reads the
// person's last message from the transcript, and when it reads like a decision or an instruction while the turn
// recorded nothing (no remember skill, no write to a docs/ folder), it sends the agent back once.
import { closeSync, fstatSync, openSync, readSync, readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
if (input.stop_hook_active || !input.transcript_path) process.exit(0);

// The turn is at the end of the transcript; a long session's file runs to many megabytes.
const fd = openSync(input.transcript_path, 'r');
const size = fstatSync(fd).size;
const length = Math.min(size, 4 << 20);
const buffer = Buffer.alloc(length);
readSync(fd, buffer, 0, length, size - length);
closeSync(fd);
const entries = buffer
  .toString('utf8')
  .split('\n')
  .slice(size > length ? 1 : 0)
  .flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });

const textOf = (content) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n')
      : '';
const isPrompt = (e) =>
  e.type === 'user' && !e.isMeta && !e.isSidechain && textOf(e.message?.content).replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '').trim();

let start = entries.length - 1;
while (start >= 0 && !isPrompt(entries[start])) start--;
if (start < 0) process.exit(0);
const said = textOf(entries[start].message.content).replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const signal =
  /\b(merk(e)? dir|halte? (das |es )?fest|festhalten|vorgabe|entschieden|entscheidung|ab sofort|ab jetzt|künftig|in zukunft|grundsätzlich|remember|from now on|going forward|decided|decision|policy)\b/i;
if (!signal.test(said)) process.exit(0);

const recorded = entries.slice(start + 1).some((e) =>
  (Array.isArray(e.message?.content) ? e.message.content : []).some(
    (c) =>
      c?.type === 'tool_use' &&
      ((c.name === 'Skill' && /remember/.test(c.input?.skill ?? '')) ||
        (/^(Write|Edit|MultiEdit)$/.test(c.name) && /\/docs\//.test(c.input?.file_path ?? '')) ||
        (c.name === 'Bash' && /docs\//.test(c.input?.command ?? '') && /git commit|>>|\btee\b/.test(c.input?.command ?? ''))),
  ),
);
if (recorded) process.exit(0);

console.log(
  JSON.stringify({
    decision: 'block',
    reason:
      `The person's message in this turn reads like a decision or an instruction ("${said.slice(0, 300)}"), and ` +
      'nothing was recorded. If it is lasting knowledge, record it with the remember skill, which decides the ' +
      'repository - also when the person asked only for "OK". If it is not, end the turn; this check asks once.',
  }),
);
