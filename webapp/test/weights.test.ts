import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = resolve(__dirname, '../src');

const sheets = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sheets(path) : name.endsWith('.css') ? [path] : [];
  });

/**
 * The look ranks by weight from the title down - title, a name, the medium for figures and what is stressed, regular
 * text (ADR 0002, "The look: Marke fein"). A weight is named by its token, never written as a figure, so the ranks
 * are set in one place; an element a browser sets bold by itself is brought to the medium; and nothing is set in
 * capitals.
 */
describe('the weights', () => {
  it('are only ever the three tokens', () => {
    // The faces' own declarations name the weight each file is cut at; everything else names a token.
    const written = sheets(SOURCE).flatMap(path =>
      [
        ...readFileSync(path, 'utf8')
          .replace(/@font-face\s*\{[^}]*\}/g, '')
          .matchAll(/font-weight:\s*([^;]+);/g),
      ].map(match => ({ path, value: match[1].trim() })),
    );

    expect(written.length).toBeGreaterThan(50);
    for (const { path, value } of written) {
      expect([path, value]).toEqual([path, expect.stringMatching(/^(var\(--weight-(regular|medium|figure|title|heading)\)|inherit)$/)]);
    }
  });

  it('bring what a browser sets bold by itself to the medium', () => {
    const global = readFileSync(join(SOURCE, 'styles/global.css'), 'utf8');
    const rule = /((?:[a-z0-9]+,\s*)+[a-z0-9]+)\s*\{\s*font-weight:\s*var\(--weight-medium\);\s*\}/.exec(global);

    expect(rule?.[1].split(/,\s*/)).toEqual(expect.arrayContaining(['b', 'strong', 'th', 'h3', 'h4', 'optgroup']));
  });

  it('never set anything in capitals', () => {
    const capitals = sheets(SOURCE).filter(path => /text-transform:\s*uppercase/.test(readFileSync(path, 'utf8')));

    expect(capitals).toEqual([]);
  });
});
