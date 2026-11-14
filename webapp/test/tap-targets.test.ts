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
 * The switch is drawn 42 by 24 px and is a finger's 44 px both ways where it is tapped. The pages each lent it the
 * rest of its target where they had thought of it, and a socket's "Nachts eigene Schaltpunkte" and Betriebsart's
 * "Energiespar-Modus" were 24 px high: the target is the switch's own now, and no page lends one.
 */
describe('the switch´s target', () => {
  const ui = readFileSync(join(SOURCE, 'ui/ui.module.css'), 'utf8');

  it('is 44 px both ways wherever the switch stands', () => {
    const drawn = /\.switch \{([^}]*)\}/.exec(ui)?.[1] ?? '';
    const reach = /\.switch::after \{([^}]*)\}/.exec(ui)?.[1] ?? '';
    const width = Number(/width:\s*(\d+)px/.exec(drawn)?.[1]);
    const height = Number(/height:\s*(\d+)px/.exec(drawn)?.[1]);
    // Absolutely placed, the reach is counted from inside the rule: out by the rule and half of what the drawn size
    // lacks of a control's height, up and down by the height, to the sides by the width.
    const lacks = (size: number) => `calc((var(--control-height) - ${size}px) / -2 - var(--rule-width))`;

    expect(reach).toMatch(/position:\s*absolute/);
    expect(/inset:\s*([^;]+);/.exec(reach)?.[1]).toBe(`${lacks(height)} ${lacks(width)}`);
    expect([width, height]).toEqual([42, 24]);
  });

  it('is lent by no page of its own', () => {
    const lending = sheets(SOURCE).filter(path => /\[role='switch'\]::after/.test(readFileSync(path, 'utf8')));
    expect(lending).toEqual([]);
  });
});
