import { screen, waitFor } from '@testing-library/react';
import { DateTime } from 'luxon';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HomeSpaceCard } from '@fg2/shared-types/v1';
import { TabBar } from '@/app/shell/TabBar';
import { LogProvider } from '@/log/LogProvider';
import { deviceWith } from './fixtures';
import { drawAt, json } from './harness';
import { spacePage, spaceWhere, THE_HOST } from './session';
import { translate } from './translations';

vi.mock('@/api/session', async importOriginal => {
  const { ON_THE_DEMO } = await import('./session');

  return { ...(await importOriginal<object>()), mediaUrl: (id: string) => `/media/${id}`, useSession: () => ON_THE_DEMO };
});

/**
 * Somebody who may only look.
 *
 * The demo is a whole account to walk around in and not a sandbox: every line
 * it tried to write would be refused by the server. So what it is shown is the
 * account without the writing - no Log button and no Steuerung in the bar; what
 * Start leaves out for it is in the Start suite. A button that is drawn and
 * then refused is worse than no button, and there is nothing here to explain
 * afterwards.
 */

const NOW = DateTime.fromISO('2026-06-10T12:00:00.000Z');

const card: HomeSpaceCard = {
  spaceId: 'space-1',
  name: 'Tent 1',
  climates: [],
  kind: 'tent',
  roomId: null,
  deviceIds: ['device-1'],
  values: [{ metric: 'temperature', value: 25.1, measuredAt: NOW.toISO()!, state: 'live' }],
  setpoints: [],
  trend: null,
  grow: {
    growId: 'grow-1',
    name: 'Spring run',
    type: 'photoperiod',
    dayNumber: 34,
    phaseDay: 10,
    stageWeek: 2,
    stage: 'flowering',
    stagesReached: ['vegetative', 'flowering'],
    preset: null,
    isAuto: false,
    plantCount: 3,
    strains: ['Amnesia'],
    coverMediaId: null,
    stageGroups: [],
  },
  entries: [],
  events: [],
  latestStill: null,
  dueTasks: [{ id: 'task-1', kind: 'water', label: 'Water', dueAt: NOW.toISO()!, assigneeId: null, subject: { type: 'grow', id: 'grow-1' } }],
  openAlerts: [],
};

const draw = (node: React.ReactNode) => drawAt(<LogProvider>{node}</LogProvider>);

beforeAll(() => translate());

describe('a session that may only look', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is offered neither the Log button nor Steuerung, and keeps Start, Grow and Verlauf', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/v1/, '');
        if (path === '/home') return json({ spaces: [card], followedGrows: [], people: [], layers: { diary: true } });
        if (path === '/devices') return json({ items: [deviceWith({ id: 'device-1', spaceId: 'space-1', ownerId: THE_HOST })], nextCursor: null });
        if (path === '/spaces') return json(spacePage(spaceWhere('view')));
        return json({ items: [], nextCursor: null });
      }),
    );
    const { container } = draw(<TabBar />);

    // The demo is shown the diary and the climate, and may neither write a line nor steer a device.
    await waitFor(() => expect([...container.querySelectorAll('nav > *')].map(tab => tab.textContent)).toEqual(['Home', 'Grow', 'Timeline']));
    expect(screen.queryByRole('button', { name: 'Log' })).not.toBeInTheDocument();
  });
});
