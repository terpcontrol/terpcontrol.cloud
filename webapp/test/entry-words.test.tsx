import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Entry } from '@fg2/shared-types/v1';
import { EntryWords } from '@/ui/EntryWords';
import { catalogue, translate } from './translations';

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), mediaUrl: (id: string) => `/media/${id}`, useSession: () => SIGNED_IN };
});

/**
 * One line of a diary, wherever it is drawn.
 *
 * The lines here are the shapes the restored production database actually holds:
 * a line migrated from the old app carries that app's label for the kind of
 * thing in `message` *and* the sentence its author typed in `text`, and a line
 * a device wrote carries only the key. What a line must never do is prefer the
 * label - the label is a translation of the kind of line it is, and
 * the sentence is the only part of the line nobody else can write again.
 */

/** An entry as the server serialises one, with the fields a line reads named by the caller. */
const entryOf = (over: Partial<Entry>): Entry => ({
  id: 'entry-1',
  createdAt: '2026-09-15T22:08:23.000Z',
  kind: 'note',
  occurredAt: '2026-09-15T21:56:00.000Z',
  source: 'human',
  authorId: 'user-1',
  growId: 'grow-1',
  spaceId: 'space-1',
  deviceId: null,
  plantIds: [],
  cameraId: null,
  taskId: null,
  alertId: null,
  severity: null,
  text: null,
  message: null,
  values: { kind: 'note' },
  mediaIds: [],
  undoUntil: null,
  ...over,
});

/** The words in a row of their own, in the browser's zone, as a list draws them. */
const Words = (props: Omit<ComponentProps<typeof EntryWords>, 'zone'>) => (
  <li>
    <EntryWords zone={null} {...props} />
  </li>
);

beforeAll(() => translate());

describe('what a diary line says', () => {
  it('draws the words a grower typed, not the migration label that came with them', () => {
    render(
      <ul>
        <Words entry={entryOf({ text: 'Super Cropping', message: { key: 'message-diary-plant-log', params: [] } })} people={[]} />
      </ul>,
    );

    expect(screen.getByText(/Super Cropping/)).toBeInTheDocument();
    expect(screen.queryByText(/Plant entry/)).not.toBeInTheDocument();
  });

  it('keeps the line breaks in a note that was written in several lines', () => {
    render(
      <ul>
        <Words
          entry={entryOf({
            text: 'Scrog-Netz eingesetzt\n2. Ventilator eingeschaltet',
            message: { key: 'message-diary-plant-log', params: [] },
          })}
          people={[]}
        />
      </ul>,
    );

    const said = screen.getByText(/Scrog-Netz eingesetzt/);
    expect(said.textContent).toBe('Scrog-Netz eingesetzt\n2. Ventilator eingeschaltet');
  });

  it('names the stage a phase line entered, whatever heading arrived with it', () => {
    render(
      <ul>
        <Words
          entry={entryOf({
            kind: 'phase',
            values: { kind: 'phase', stage: 'vegetative', phaseId: 'phase-1', preset: null },
            message: { key: 'message-diary-plant-lifecycle', params: [] },
          })}
          people={[]}
        />
      </ul>,
    );

    expect(screen.getByText(/Entered Veg/)).toBeInTheDocument();
    expect(screen.queryByText(/Plant phase change/)).not.toBeInTheDocument();
  });

  it('puts a note written under a phase line after the stage rather than in place of it', () => {
    render(
      <ul>
        <Words
          entry={entryOf({
            kind: 'phase',
            values: { kind: 'phase', stage: 'germination', phaseId: 'phase-1', preset: null },
            text: 'Steckling von Sensi Seeds',
          })}
          people={[]}
        />
      </ul>,
    );

    expect(screen.getByText(/Entered Germination · Steckling von Sensi Seeds/)).toBeInTheDocument();
  });

  it('says from where to where a move went, by the names its line was told - the place left may be gone', () => {
    const move = { kind: 'move', placementId: 'placement-2', spaceId: 'space-2' } as const;
    render(
      <ul>
        <Words entry={entryOf({ kind: 'move', values: { ...move, from: 'Zelt Eins', to: 'Zelt 1' } })} people={[]} />
        <Words entry={entryOf({ id: 'entry-2', kind: 'move', values: { ...move, spaceId: null, from: 'Zelt 1', to: null } })} people={[]} />
        <Words entry={entryOf({ id: 'entry-3', kind: 'move', values: move })} people={[]} />
        <Words entry={entryOf({ id: 'entry-4', kind: 'move', values: { ...move, from: null, to: 'Zweitzelt' } })} people={[]} />
      </ul>,
    );

    expect(screen.getByText(/moved it from Zelt Eins to Zelt 1/)).toBeInTheDocument();
    // No fixed place is no place to name: put into a tent from none, taken out of one into none.
    expect(screen.getByText(/took it out of Zelt 1$/)).toBeInTheDocument();
    expect(screen.getByText(/put it in Zweitzelt$/)).toBeInTheDocument();
    expect(screen.queryByText(/no fixed place/)).not.toBeInTheDocument();
    // A line written before a move named its places says what it always said.
    expect(screen.getByText(/moved it$/)).toBeInTheDocument();
  });

  /** "Du hast von Zelt Eins nach Zelt Zwei umgestellt" said a move as a rearrangement: the plants moved, "umgezogen". */
  it('says a move in German as the word the move sheet uses, "umgezogen"', async () => {
    const done = ((await catalogue('de')).home as { entryDone: Record<string, string> }).entryDone;

    expect([done.move, done.move_you, done.moveFromTo, done.moveFromTo_you]).toEqual([
      'hat umgezogen',
      'hast umgezogen',
      'hat von {{from}} nach {{to}} umgezogen',
      'hast von {{from}} nach {{to}} umgezogen',
    ]);
  });

  it('still translates what a device wrote, which is a key and not words', () => {
    render(
      <ul>
        <Words
          entry={entryOf({ kind: 'system', source: 'device', authorId: null, text: null, message: { key: 'message-co2-low', params: [] } })}
          people={[]}
        />
      </ul>,
    );

    expect(screen.getByText(/Low CO₂/)).toBeInTheDocument();
  });
});

/**
 * A machine writes a key and the parameters that make it one event rather than
 * a category. The restored production database holds 33,059 lines keyed
 * `message-alarm-triggered` and 49,971 keyed `message-alarm-resolved`, every one
 * of which draws the same two words until the parameters are drawn with them.
 */
describe('what a machine´s line says under its headline', () => {
  const said = (over: Partial<Entry>) =>
    render(
      <ul>
        <Words entry={entryOf({ kind: 'alarm', source: 'device', authorId: null, text: null, ...over })} people={[]} />
      </ul>,
    );

  it('draws the reading and the thresholds an alarm tripped on, not only that an alarm was raised', () => {
    said({ message: { key: 'message-alarm-triggered', params: ['Temperatur (temperature), value=16.87, upper threshold=n/a, lower threshold=20'] } });

    expect(screen.getByText('Alarm triggered')).toBeInTheDocument();
    // Rounded and written as the alert card writes it, not as the server's prose.
    expect(screen.getByText('Temperatur · Temperature 16.9 °C · below 20 °C')).toBeInTheDocument();
  });

  it('tells two alarms of one night apart, which the headline alone cannot', () => {
    const first = said({ message: { key: 'message-alarm-triggered', params: ['Temperatur (temperature), lower threshold=20'] } });
    const second = said({ message: { key: 'message-alarm-triggered', params: ['Temperatur (temperature), lower threshold=15'] } });

    expect(first.container.textContent).not.toBe(second.container.textContent);
  });

  it('names the step a recipe advanced to', () => {
    said({ kind: 'plan', source: 'plan', message: { key: 'message-recipe-advanced', params: ['10 (Blütewoche 4)'] } });

    expect(screen.getByText(/step 10 \(Blütewoche 4\)/)).toBeInTheDocument();
  });

  it('keeps the settings a saved configuration changed on the lines they arrived in', () => {
    said({ kind: 'system', message: { key: 'message-device-configuration-updated', params: ['day.humidity: 60 -> 58\nlights.limit: 55 -> 60'] } });

    expect(screen.getByText(/day\.humidity: 60 -> 58/).textContent).toContain('lights.limit: 55 -> 60');
  });

  it('says nothing more where the key carries no parameters, because its text only restates its title', () => {
    const { container } = said({ kind: 'system', message: { key: 'message-diary-plant-log', params: [] } });

    expect(container.textContent).toContain('Plant entry');
    expect(container.textContent).not.toContain('A line written in the diary of the plants.');
  });

  /**
   * The unkeyed half of the same problem. A migrated line keeps the old app's
   * free-form title joined to its body with a blank line, `pre-line` draws that
   * blank line, and the row becomes three lines with its own title at the top
   * of two of them - beside keyed rows on the same screen that draw as a title
   * over a detail.
   */
  it('does not print a migrated line´s own title a second time under itself', () => {
    const { container } = said({
      text: 'Alarm Kühlschrank Dauerlauf resolved\n\nAlarm Kühlschrank Dauerlauf resolved: Sensor dehumidifier, value: 1',
      message: null,
    });

    expect(screen.getAllByText(/Alarm Kühlschrank Dauerlauf resolved/)).toHaveLength(1);
    expect(container.textContent).toContain('Sensor dehumidifier, value: 1');
    expect(container.textContent).not.toContain('\n\n');
  });

  it('does not print a grower´s own paragraph a second time under itself', () => {
    render(
      <ul>
        <Words
          entry={entryOf({
            kind: 'phase',
            values: { kind: 'phase', stage: 'drying', phaseId: 'phase-1', preset: null },
            text: 'Alles abgeerntet und aufgehängt',
            message: { key: 'message-diary-plant-lifecycle', params: ['drying'] },
          })}
          people={[]}
        />
      </ul>,
    );

    expect(screen.getAllByText(/Alles abgeerntet und aufgehängt/)).toHaveLength(1);
  });
});

/**
 * Who wrote a line, said the way a person would. What somebody did opens with
 * them as its subject - "You watered", "anna watered" - and somebody's own
 * words are their own: a line of the reader's carries no name at all, and
 * another person's is introduced as theirs. "you Stripped the lower leaves"
 * read as a sentence nobody would write.
 */
describe('who a line is by', () => {
  const people = [{ id: 'user-anna', handle: 'anna' }];
  const row = (over: Partial<Entry>) => {
    render(
      <ul>
        <Words entry={entryOf(over)} people={people} />
      </ul>,
    );
    return screen.getByRole('listitem');
  };

  it('puts no name before the reader´s own words', () => {
    const line = row({ text: 'Stripped the lower leaves' });

    expect(line).toHaveTextContent('Stripped the lower leaves');
    expect(line.textContent).not.toMatch(/you/i);
  });

  it('introduces another person´s words as theirs', () => {
    const line = row({ authorId: 'user-anna', text: 'Stripped the lower leaves' });

    expect(screen.getByText('anna')).toBeInTheDocument();
    expect(line).toHaveTextContent('anna: Stripped the lower leaves');
  });

  it('makes the reader the subject of what they did, capitalised as a sentence opens', () => {
    const line = row({ kind: 'water', values: { kind: 'water' } as Entry['values'] });

    expect(line).toHaveTextContent('You watered');
  });

  it('makes another person the subject of what they did', () => {
    const line = row({ kind: 'water', authorId: 'user-anna', values: { kind: 'water' } as Entry['values'] });

    expect(line).toHaveTextContent('anna watered');
    expect(line.textContent).not.toMatch(/anna:/);
  });

  it('says how much was poured, and for a feed the week of the scheme it was dosed by', () => {
    expect(row({ kind: 'water', values: { kind: 'water', litres: 1.5, readings: [] } })).toHaveTextContent('You watered · 1.5 L');
    cleanup();
    expect(row({ kind: 'feed', values: { kind: 'feed', litres: 5, schemeWeek: 5, doses: [], readings: [] } })).toHaveTextContent(
      'You fed · 5 L · scheme week 5',
    );
  });
});

/** A line about one plant of three said "Du hast gegossen · 1,5 L" where the toast had said "Gegossen · B2". */
describe('a line about some of a grow´s plants', () => {
  const plants = [
    { id: 'a1', growId: 'grow-1', label: 'A1' },
    { id: 'b2', growId: 'grow-1', label: 'B2' },
    { id: 'c3', growId: 'grow-1', label: 'C3' },
    { id: 'x1', growId: 'grow-2', label: 'X1' },
  ];
  const water = (plantIds: string[]) => entryOf({ kind: 'water', plantIds, values: { kind: 'water', litres: 1.5 } as Entry['values'] });

  it('names them where the grow has more than one, and says nothing of plants where it is about all or none', () => {
    const { container, rerender } = render(<Words entry={water(['b2'])} people={[]} measurements={[]} plants={plants} />);
    expect(container.textContent).toMatch(/B2/);
    expect(container.textContent).not.toMatch(/A1|C3|X1/);

    rerender(<Words entry={water(['a1', 'c3'])} people={[]} measurements={[]} plants={plants} />);
    expect(container.textContent).toMatch(/A1, C3/);

    rerender(<Words entry={water(['a1', 'b2', 'c3'])} people={[]} measurements={[]} plants={plants} />);
    expect(container.textContent).not.toMatch(/A1|B2|C3/);

    // A grow of one plant has nothing to tell apart.
    rerender(<Words entry={water(['x1'])} people={[]} measurements={[]} plants={plants} />);
    expect(container.textContent).not.toMatch(/X1/);
    cleanup();
  });
});
