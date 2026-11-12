/**
 * The lines of the diary entry a person's save of a device's settings writes:
 * "day.temperature: 24 → 25", one for each figure that moved, by its dotted
 * place in the device's document.
 *
 * They are read back as well as written - a device that fell silent holds the
 * `before` of the first line written since - so both directions are here, and
 * a change to how a line is spelled reaches its reader with it.
 */

/** The message key of that entry. */
export const CONFIGURATION_UPDATED = 'message-device-configuration-updated';

/**
 * Where the lines name what germination does about the humidity. Those choices
 * are the cloud's and no figure of the document, so nothing a device holds.
 */
export const GERMINATION_CHOICES = 'germination';

const NOTHING = '–';

/** A figure as a line says it: nothing as a dash, a word as itself, anything else as JSON. */
export const figureOf = (value: unknown): string =>
  value === undefined || value === null ? NOTHING : typeof value === 'string' ? value : JSON.stringify(value);

export const changeLine = (path: string, before: unknown, after: unknown): string => `${path}: ${figureOf(before)} → ${figureOf(after)}`;

/** A line read back, its two figures as it says them (`figureOf`). */
export interface ChangeSaid {
  path: string;
  before: string;
  after: string;
}

const LINE = /^(.+?): (.*) → (.*)$/;

/** Null for a line that names no change: the count of the figures left out of a long entry, or a line from before this format. */
export const changeOf = (line: string): ChangeSaid | null => {
  const said = LINE.exec(line);
  return said ? { path: said[1], before: said[2], after: said[3] } : null;
};

/** The lines as the entry's first parameter carries them, and back. */
export const linesJoined = (lines: readonly string[]): string => lines.join('\n');

export const linesOf = (joined: string | undefined): string[] => (joined ? joined.split('\n') : []);

/** A figure a line says, as a value again: the number it spells, null for nothing, and its words otherwise. */
export const figureSaid = (said: string): number | string | null => {
  if (said === NOTHING) return null;
  const number = Number(said);
  return Number.isFinite(number) && String(number) === said ? number : said;
};
