import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { HomeSpaceCard } from '@fg2/shared-types/v1';
import { TabBar } from '@/app/shell/TabBar';
import { SpaceCard } from '@/screens/home/SpaceCard';
import { DueStrip } from '@/screens/home/Strips';
import { LogProvider } from '@/log/LogProvider';

vi.mock('@/api/session', async importOriginal => {
  const { ON_THE_DEMO } = await import('./session');

  return { ...(await importOriginal<object>()), mediaUrl: (id: string) => `/media/${id}`, useSession: () => ON_THE_DEMO };
});

/**
 * Somebody who may only look.
 *
 * The demo is a whole account to walk around in and not a sandbox: every line
 * it tried to write would be refused by the server. So what it is shown is the
 * account without the writing - no raised Log button, no Water on a card, no
 * Done on what is due. A button that is drawn and then refused is worse than no
 * button, and there is nothing here to explain afterwards.
 */

const NOW = DateTime.fromISO('2026-06-10T12:00:00.000Z');

const card: HomeSpaceCard = {
  spaceId: 'space-1',
  name: 'Tent 1',
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
    stage: 'flowering',
    preset: null,
    isAuto: false,
    plantCount: 3,
    strains: ['Amnesia'],
    coverMediaId: null,
    stageGroups: [],
  },
  entries: [],
  latestStill: null,
  dueTasks: [{ id: 'task-1', kind: 'water', label: 'Water', dueAt: NOW.toISO()!, assigneeId: null, subject: { type: 'grow', id: 'grow-1' } }],
  openAlerts: [],
};

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

describe('a session that may only look', () => {
  it('is not offered the Log button, and keeps the four places', () => {
    const { container } = draw(<TabBar />);

    expect(screen.queryByRole('button', { name: 'Log' })).not.toBeInTheDocument();
    expect([...container.querySelectorAll('nav > *')].map(tab => tab.textContent)).toEqual(['Home', 'Timeline', 'Devices', 'Tasks']);
  });

  it('sees the card and what is due on it, and is offered neither Water nor Done', () => {
    draw(
      <>
        <DueStrip cards={[card]} now={NOW} />
        <SpaceCard card={card} people={[]} now={NOW} compact={false} />
      </>,
    );

    expect(screen.getAllByText(/Spring run/).length).toBeGreaterThan(0);
    expect(screen.getByText('Water')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Water/ })).not.toBeInTheDocument();
  });
});
