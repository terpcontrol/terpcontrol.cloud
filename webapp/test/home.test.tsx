import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessNeed, HomeSpaceCard } from '@fg2/shared-types/v1';
import { attentionOf, isClub, livenessOf, sortedByAttention } from '@/screens/home/attention';
import { SpaceCard } from '@/screens/home/SpaceCard';
import { AttentionStrip, DueStrip, FollowingStrip } from '@/screens/home/Strips';
import { LogProvider } from '@/log/LogProvider';

// What a card offers depends on who is looking, so a test says who that is.
vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
});

/**
 * The other half of "who is looking": the same account owns one tent and is
 * only let into the next, and what a card may offer is the place's standing
 * rather than the session's. The home's own answer carries no such field, so
 * the space list is where a card reads it - and every place a card here stands
 * in answers the same, which is what makes one line in a test enough.
 */
const may = vi.hoisted(() => ({ youMay: 'own' as AccessNeed }));

vi.mock('@/api/spaces', async importOriginal => {
  const { spaceWhere, spacesAnswering } = await import('./session');
  const places = ['space-1', 'space-2', 'space-3', 'space-4', 'space-5', 'space-empty', 'space-device-only'];

  return { ...(await importOriginal<object>()), useSpaces: () => spacesAnswering(...places.map(id => spaceWhere(may.youMay, { id }))) };
});

beforeEach(() => {
  may.youMay = 'own';
});

/**
 * One card per space, drawn from what the server answered and nothing else:
 * the values with their targets and ages, dimmed when old and never hidden;
 * the grow with its counter, its "auto" tag and its strains; and the one-line
 * invitation where a half is empty.
 */

const NOW = DateTime.fromISO('2026-06-10T12:00:00.000Z');
const at = (secondsAgo: number) => NOW.minus({ seconds: secondsAgo }).toISO()!;

const card = (over: Partial<HomeSpaceCard>): HomeSpaceCard => ({
  spaceId: 'space-1',
  name: 'Tent 1',
  kind: 'tent',
  roomId: null,
  deviceIds: ['device-1'],
  values: [
    { metric: 'temperature', value: 25.1, measuredAt: at(20), state: 'live' },
    { metric: 'humidity', value: 57, measuredAt: at(20), state: 'live' },
    { metric: 'co2', value: 1010, measuredAt: at(20), state: 'live' },
  ],
  setpoints: [
    { metric: 'temperature', value: 25, band: 1 },
    { metric: 'humidity', value: 50, band: 5 },
  ],
  trend: { metric: 'temperature', stepSeconds: 1800, endsAt: NOW.toISO()!, points: [24.6, 25.0, null, 25.3, 25.1] },
  grow: {
    growId: 'grow-1',
    name: 'Spring run',
    type: 'photoperiod',
    dayNumber: 34,
    phaseDay: 10,
    stageWeek: 2,
    stage: 'flowering',
    preset: 'flower',
    isAuto: true,
    plantCount: 3,
    strains: ['Amnesia', 'Gelato'],
    coverMediaId: null,
    stageGroups: [],
  },
  entries: [
    {
      id: 'entry-1',
      createdAt: at(86_400),
      kind: 'note',
      occurredAt: at(86_400),
      source: 'human',
      authorId: 'user-mia',
      growId: 'grow-1',
      spaceId: 'space-1',
      deviceId: null,
      plantIds: [],
      cameraId: null,
      taskId: null,
      alertId: null,
      severity: null,
      text: 'Defoliated',
      message: null,
      values: { kind: 'note' },
      mediaIds: [],
      undoUntil: null,
    },
  ],
  latestStill: null,
  dueTasks: [],
  openAlerts: [],
  ...over,
});

const people = [{ id: 'user-mia', handle: 'mia' }];

// Every card can log: the sheet and the toast live above the screens, so a
// screen drawn on its own is drawn inside them.
const draw = (node: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <LogProvider>{node}</LogProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

describe('the climate half', () => {
  it('shows each value large with its target beside it, and says whether it is in band', () => {
    draw(<SpaceCard card={card({})} people={people} now={NOW} compact={false} />);

    const temperature = screen.getByText('25.1').closest('[data-age]')!;
    expect(temperature).toHaveAttribute('data-age', 'live');
    expect(temperature).toHaveTextContent('→ 25');
    expect(temperature).toHaveTextContent('in band');

    // Judged by the band the server put on the setpoint: 5 either side, so 57 is out and 55 would not be.
    // A reading out of band says which way in words, as its in-band siblings say theirs.
    const humidity = screen.getByText('57').closest('[data-age]')!;
    expect(humidity).toHaveTextContent('→ 50');
    expect(humidity).toHaveTextContent('+7 high');
  });

  it('dims an old value by its age and never hides it', () => {
    const stale = card({
      values: [{ metric: 'temperature', value: 24.2, measuredAt: at(3 * 3600), state: 'offline' }],
    });
    draw(<SpaceCard card={stale} people={people} now={NOW} compact={false} />);

    expect(screen.getByText('24.2').closest('[data-age]')).toHaveAttribute('data-age', 'offline');
    expect(screen.getByText(/no reading · 3 h/)).toBeInTheDocument();
  });

  // The card the home failed to refresh is the card it already had: every
  // value on it still says "live", because it did when the answer was made.
  it('dims and renames a value the screen has gone on drawing past its own age', () => {
    const answered = card({ values: [{ metric: 'temperature', value: 23.8, measuredAt: at(20), state: 'live' }] });

    draw(<SpaceCard card={answered} people={people} now={NOW} compact={false} />);
    expect(screen.getByText('23.8').closest('[data-age]')).toHaveAttribute('data-age', 'live');
    expect(screen.getByText(/^live · 20 s$/)).toBeInTheDocument();

    // Twelve minutes on with nothing new to draw, the app's own constant calls
    // that reading offline, so the figure dims and the pill stops saying live.
    draw(<SpaceCard card={answered} people={people} now={NOW.plus({ minutes: 12 })} compact={false} />);
    const frozen = screen.getAllByText('23.8').at(-1)!.closest('[data-age]')!;
    expect(frozen).toHaveAttribute('data-age', 'offline');
    expect(screen.getByText(/^no reading · 12 min$/)).toBeInTheDocument();
    expect(screen.queryByText(/^live · 12 min$/)).not.toBeInTheDocument();
  });

  it('ages the newest reading and leaves the word "offline" to the device itself', () => {
    // The two are different instants - a device is heard on every status, and
    // its newest stored sample is something else again - so the same word for
    // both put two ages for one silence on one screen. The pill is about the
    // place's readings, which is all a shared or public reader is told about.
    const quiet = card({ values: [{ metric: 'temperature', value: 24.2, measuredAt: at(4 * 86_400), state: 'offline' }] });
    draw(<SpaceCard card={quiet} people={people} now={NOW} compact={false} />);

    expect(screen.getByText(/no reading · 4 d/)).toBeInTheDocument();
    expect(screen.queryByText(/offline · 4 d/)).not.toBeInTheDocument();
  });

  it('draws the day of temperature the card came with, and asks for nothing more', () => {
    draw(<SpaceCard card={card({})} people={people} now={NOW} compact={false} />);

    expect(screen.getByRole('img', { name: 'Temperature in Tent 1 over the last 24 hours' })).toBeInTheDocument();
    expect(screen.getByText('24 h')).toBeInTheDocument();
  });

  it('says a metric has no target where the controller holds none', () => {
    draw(<SpaceCard card={card({ setpoints: [] })} people={people} now={NOW} compact={false} />);

    expect(screen.getByText('1010').closest('[data-age]')).toHaveTextContent('no target');
  });

  it('invites a place with nothing measuring to log a reading or add a device', () => {
    draw(<SpaceCard card={card({ deviceIds: [], values: [], setpoints: [], grow: null, entries: [] })} people={people} now={NOW} compact={false} />);

    expect(screen.getByText(/No sensor/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log a reading' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a device' })).toBeInTheDocument();
    expect(screen.queryByText(/live/)).not.toBeInTheDocument();
  });
});

describe('the grow half', () => {
  it('shows the day counter, the phase with its auto tag, the strains and who wrote the newest entry', () => {
    draw(<SpaceCard card={card({})} people={people} now={NOW} compact={false} />);

    expect(screen.getByText('34')).toBeInTheDocument();
    expect(screen.getByText(/Flower · wk 2/)).toBeInTheDocument();
    expect(screen.getByText('auto')).toBeInTheDocument();
    expect(screen.getByText(/Amnesia, Gelato/)).toBeInTheDocument();
    expect(screen.getByText('Defoliated')).toBeInTheDocument();
    expect(screen.getByText(/1 d ago · mia/)).toBeInTheDocument();
    // The place and the grow each open their page. The three actions go
    // nowhere: they open the Log sheet over the card they were tapped on.
    expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['/spaces/space-1', '/grows/grow-1']);
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Water', 'Note', 'Photo']);
  });

  it('draws no auto tag for a phase a person set', () => {
    const grow = { ...card({}).grow!, isAuto: false };
    draw(<SpaceCard card={card({ grow })} people={people} now={NOW} compact={false} />);

    expect(screen.queryByText('auto')).not.toBeInTheDocument();
  });

  it('invites a place without a grow in the record´s words, and takes "not now" for an answer', () => {
    draw(<SpaceCard card={card({ grow: null, entries: [] })} people={people} now={NOW} compact={false} />);

    const invite = screen.getByText(/Nothing growing here yet/);
    expect(invite).toHaveTextContent('Nothing growing here yet · Start a grow · Move a grow here · Not now');

    fireEvent.click(screen.getByRole('button', { name: /Not now/ }));
    expect(screen.queryByText(/Nothing growing here yet/)).not.toBeInTheDocument();
  });

  // Both ways out of an empty half are about this card's place. A sheet opened
  // with no subject falls back to whatever the account has running elsewhere,
  // which is how one tap on an empty tent ends a flowering grow in another.
  it('points both invitations at this card´s own place', () => {
    draw(<SpaceCard card={card({ spaceId: 'space-empty', grow: null, entries: [] })} people={people} now={NOW} compact={false} />);

    expect(screen.getByRole('link', { name: 'Start a grow' })).toHaveAttribute('href', '/grows/new?space=space-empty');

    fireEvent.click(screen.getByRole('button', { name: 'Move a grow here' }));
    expect(screen.getByRole('dialog', { name: 'Move a grow into Tent 1' })).toBeInTheDocument();
  });

  /**
   * Starting a grow here and moving one in are both `manage` on this place, and
   * the server refuses either from a membership that only logs. Offered on the
   * card they are two dead ends: the New-grow sheet drops the very place the
   * invitation names, and Move here opens a sheet whose primary the server will
   * turn down. The tent's own Overview has hidden the same pair all along.
   */
  it('offers neither way into an empty place to somebody who may only write lines in it', () => {
    may.youMay = 'log';
    draw(<SpaceCard card={card({ spaceId: 'space-empty', grow: null, entries: [] })} people={people} now={NOW} compact={false} />);

    expect(screen.getByText('Nothing growing here yet')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Start a grow' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move a grow here' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Not now/ })).not.toBeInTheDocument();
  });

  it('keeps both ways in for somebody who steers the place', () => {
    may.youMay = 'manage';
    draw(<SpaceCard card={card({ spaceId: 'space-empty', grow: null, entries: [] })} people={people} now={NOW} compact={false} />);

    expect(screen.getByRole('link', { name: 'Start a grow' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move a grow here' })).toBeInTheDocument();
  });

  it('draws a grow with no place at all, and opens it at the grow because there is no place to open', () => {
    const nowhere = card({ spaceId: null, kind: null, name: 'Windowsill basil', deviceIds: [], values: [], setpoints: [], trend: null });
    draw(<SpaceCard card={nowhere} people={people} now={NOW} compact={false} />);

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Spring run');
    expect(screen.getByText('No fixed place')).toBeInTheDocument();
    expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['/grows/grow-1']);
    expect(screen.queryByText(/No sensor/)).not.toBeInTheDocument();
  });

  /**
   * "auto" means nobody picked this, which is what the app's own vocabulary
   * uses the word for. The plan engine records the person behind a transition
   * all the way to the entry, so a step somebody activated by hand was bylined
   * "auto" over a sentence reading "has been manually activated by the user",
   * with the store holding the author the whole time.
   */
  it('bylines a plan line somebody drove as theirs, and the engine´s own moves as auto', () => {
    const drove = { ...card({}).entries[0], kind: 'plan' as const, source: 'plan' as const, authorId: 'user-mia', text: 'Recipe step activated' };
    draw(<SpaceCard card={card({ grow: null, entries: [drove] })} people={people} now={NOW} compact={false} />);

    expect(screen.getByText(/· mia/)).toBeInTheDocument();
    expect(screen.queryByText(/· auto/)).not.toBeInTheDocument();
  });

  it('keeps auto for the plan line no person stands behind', () => {
    const itself = { ...card({}).entries[0], kind: 'plan' as const, source: 'plan' as const, authorId: null, text: 'Recipe moved on' };
    draw(<SpaceCard card={card({ grow: null, entries: [itself] })} people={people} now={NOW} compact={false} />);

    expect(screen.getByText(/· auto/)).toBeInTheDocument();
  });

  it('shows a place without a grow its own newest line - what its device or an alarm wrote', () => {
    const line = { ...card({}).entries[0], growId: null, source: 'alarm' as const, authorId: null, text: 'Humidity high 72 % · resolved' };
    draw(<SpaceCard card={card({ spaceId: 'space-device-only', grow: null, entries: [line] })} people={people} now={NOW} compact={false} />);

    expect(screen.getByText('Humidity high 72 % · resolved')).toBeInTheDocument();
    expect(screen.getByText(/· alarm/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing growing here yet/)).toBeInTheDocument();
  });

  it('lets the grow take the header when there is no device', () => {
    const diaryOnly = card({ name: 'Balcony', kind: 'balcony', deviceIds: [], values: [], setpoints: [] });
    draw(<SpaceCard card={diaryOnly} people={people} now={NOW} compact={false} />);

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Spring run');
    expect(screen.getByText('Balcony')).toBeInTheDocument();
    expect(screen.getAllByRole('link').map(link => link.textContent)).toEqual(['Spring run', 'Balcony']);
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Water', 'Photo', 'Reading']);
  });
});

describe('what needs a person', () => {
  const alarming = card({
    spaceId: 'space-2',
    name: 'Flower room B',
    openAlerts: [{ alertId: 'alert-1', kind: 'threshold', severity: 'critical', startedAt: at(600), value: 68, metric: 'humidity' }],
  });
  const due = card({
    spaceId: 'space-3',
    name: 'Veg room',
    dueTasks: [{ id: 'task-1', kind: 'water', label: 'Water', dueAt: NOW.toISO()!, subject: { type: 'grow', id: 'grow-1' }, assigneeId: null }],
  });

  it('orders the cards by what needs a person, and keeps the rest in the order given', () => {
    const quiet = card({ spaceId: 'space-1' });
    expect(sortedByAttention([quiet, due, alarming]).map(item => item.spaceId)).toEqual(['space-2', 'space-3', 'space-1']);
    expect(attentionOf(alarming)).toBeGreaterThan(attentionOf(due));
  });

  it('is a club once places are grouped under rooms', () => {
    expect(isClub([card({}), card({})])).toBe(false);
    expect(isClub([card({ roomId: 'room-1' })])).toBe(true);
  });

  it('draws the attention and due strips only from what is open or due', () => {
    draw(
      <>
        <AttentionStrip cards={[card({}), alarming]} now={NOW} />
        <DueStrip cards={[card({}), due]} now={NOW} />
      </>,
    );

    const attention = screen.getByRole('list', { name: 'Needs attention' });
    expect(within(attention).getAllByRole('listitem')).toHaveLength(1);
    expect(attention).toHaveTextContent('Alarm · 68 % RH · Flower room B');

    const dueList = screen.getByRole('list', { name: 'Due' });
    expect(dueList).toHaveTextContent('Water · Spring run');
    expect(dueList).toHaveTextContent('today');
    expect(within(dueList).getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  // A task three days out is three days out. Calling everything past today
  // "tomorrow" turns a week's worth of chores into one that all look urgent.
  it('counts a task down in days once it is further off than tomorrow', () => {
    const later = card({
      spaceId: 'space-5',
      name: 'Veg room',
      dueTasks: [
        {
          id: 'task-3',
          kind: 'chore',
          label: 'Check trichomes',
          dueAt: NOW.plus({ days: 3 }).toISO()!,
          subject: { type: 'space', id: 'space-5' },
          assigneeId: null,
        },
        {
          id: 'task-4',
          kind: 'water',
          label: 'Water',
          dueAt: NOW.plus({ days: 1 }).toISO()!,
          subject: { type: 'space', id: 'space-5' },
          assigneeId: null,
        },
      ],
    });
    draw(<DueStrip cards={[later]} now={NOW} />);

    expect(within(screen.getByText('Water').closest('li')!).getByText('tomorrow')).toBeInTheDocument();
    expect(within(screen.getByText('Check trichomes').closest('li')!).getByText('in 3 d')).toBeInTheDocument();
  });

  // The tent's own chores are the tent's, and stay the tent's while a grow
  // stands in it: naming one after the grow sends a person to the wrong place.
  it('names a chore after the place it is about rather than after the grow standing there', () => {
    const chore = card({
      spaceId: 'space-4',
      name: 'Veg room',
      dueTasks: [
        {
          id: 'task-2',
          kind: 'chore',
          label: 'Clean the carbon filter',
          dueAt: NOW.toISO()!,
          subject: { type: 'space', id: 'space-4' },
          assigneeId: null,
        },
      ],
    });
    draw(<DueStrip cards={[chore]} now={NOW} />);

    expect(screen.getByRole('list', { name: 'Due' })).toHaveTextContent('Clean the carbon filter · Veg room');
  });

  it('draws nothing at all when nothing is open, due or followed', () => {
    const { container } = draw(
      <>
        <AttentionStrip cards={[card({})]} now={NOW} />
        <DueStrip cards={[card({})]} now={NOW} />
        <FollowingStrip grows={[]} now={NOW} />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('lists a followed grow under its owner´s handle', () => {
    draw(
      <FollowingStrip
        grows={[
          {
            growId: 'grow-9',
            slug: 'autoflower-run',
            name: 'Autoflower run',
            handle: 'greenthumb',
            dayNumber: 51,
            stage: 'flowering',
            endedAt: null,
            coverMediaId: null,
            updatedAt: at(3 * 3600),
          },
        ]}
        now={NOW}
      />,
    );

    expect(screen.getByText('@greenthumb · Autoflower run')).toBeInTheDocument();
    expect(screen.getByText(/Day 51 · Flower · 3 h ago/)).toBeInTheDocument();
  });

  it('says of a followed grow that has ended that it has, rather than drawing it as one still running', () => {
    draw(
      <FollowingStrip
        grows={[
          {
            growId: 'grow-9',
            slug: 'autoflower-run',
            name: 'Autoflower run',
            handle: 'greenthumb',
            dayNumber: 218,
            stage: 'curing',
            endedAt: '2026-08-24T15:31:56.000Z',
            coverMediaId: null,
            updatedAt: at(3 * 3600),
          },
        ]}
        now={NOW}
      />,
    );

    // The day number is the grow's last day and stays; the age is when its
    // diary last moved, which is neither the end nor a sign of one.
    expect(screen.getByText(/Day 218 · Curing · ended 24 Aug 2026 · 3 h ago/)).toBeInTheDocument();
  });
});

describe('liveness', () => {
  it('is the best of the values, offline for a device that has said nothing, and none without a device', () => {
    expect(livenessOf(card({}), NOW)).toBe('live');
    expect(livenessOf(card({ values: [{ metric: 'temperature', value: 1, measuredAt: at(300), state: 'stale' }] }), NOW)).toBe('stale');
    expect(livenessOf(card({ values: [] }), NOW)).toBe('offline');
    expect(livenessOf(card({ deviceIds: [], values: [] }), NOW)).toBe('none');
  });

  // The dot is a card's one word about whether the place is alive, so it is
  // read at the moment somebody is looking rather than at the moment the home
  // last managed to ask.
  it('falls with the values when the card has gone on being drawn without a new answer', () => {
    const answered = card({ values: [{ metric: 'temperature', value: 1, measuredAt: at(20), state: 'live' }] });

    expect(livenessOf(answered, NOW)).toBe('live');
    expect(livenessOf(answered, NOW.plus({ minutes: 4 }))).toBe('stale');
    expect(livenessOf(answered, NOW.plus({ minutes: 12 }))).toBe('offline');
  });
});
