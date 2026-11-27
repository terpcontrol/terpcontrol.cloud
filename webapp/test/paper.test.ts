import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * What a stylesheet decides and jsdom cannot lay out: read from the source.
 * Each rule is listed with the at-rules it stands inside, outermost first.
 */
const rulesOf = (file: string): { selector: string; within: string[]; body: string }[] => {
  const css = readFileSync(resolve(__dirname, '../src', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: { selector: string; within: string[]; body: string }[] = [];
  const open: string[] = [];
  let head = '';
  let body = '';
  let depth = 0;
  for (const char of css) {
    if (char === '{') {
      open.push(head.trim());
      head = '';
      body = '';
      depth += 1;
    } else if (char === '}') {
      const selector = open.pop() ?? '';
      if (!selector.startsWith('@')) rules.push({ selector, within: open.filter(one => one.startsWith('@')), body });
      depth -= 1;
      head = '';
    } else if (char === ';') {
      body += head + ';';
      head = '';
    } else {
      head += char;
    }
  }
  expect(depth).toBe(0);
  return rules;
};

describe('paper', () => {
  /** A report printed from the dark theme was the dark mode's pale ink on a white sheet: a browser prints no background unless asked. */
  it('is light whatever the theme: every rule that writes the dark tokens is the screen´s alone', () => {
    const dark = rulesOf('theme/tokens.css').filter(
      rule => rule.selector.includes("data-theme='dark'") || rule.within.some(at => at.includes('prefers-color-scheme: dark')),
    );

    expect(dark.length).toBeGreaterThanOrEqual(2);
    for (const rule of dark) {
      expect(rule.body).toContain('--ink:');
      expect(rule.within.some(at => /^@media\s+screen\b/.test(at))).toBe(true);
    }
    // The light set stands on the root itself, outside any media query, so it is what print reads.
    const light = rulesOf('theme/tokens.css').find(rule => rule.selector === ':root' && rule.within.length === 0 && rule.body.includes('--ink: #'));
    expect(light).toBeDefined();
  });

  it('leaves off what is there to be tapped', () => {
    const omitted = rulesOf('styles/global.css').find(rule => rule.selector === "[data-print='omit']");

    expect(omitted?.within).toEqual(['@media print']);
    expect(omitted?.body).toMatch(/display:\s*none/);
  });
});

describe('a control the keyboard moves to on a phone', () => {
  /** Below the rail's width the tab bar is fixed over the page's foot and the top bar sticks over its head. */
  it('is scrolled clear of both bars', () => {
    const padded = rulesOf('styles/global.css').find(rule => rule.selector === 'html' && rule.within.includes('@media (max-width: 899px)'));

    expect(padded?.body).toMatch(/scroll-padding-top:\s*calc\(var\(--topbar-height\)/);
    expect(padded?.body).toMatch(/scroll-padding-bottom:\s*calc\(var\(--tabbar-height\)/);
  });
});
