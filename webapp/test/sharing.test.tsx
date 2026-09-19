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
import type { GrowListItem, ShareLink } from '@fg2/shared-types/v1';
import { ShareSheet } from '@/screens/grow/ShareSheet';

/**
 * The owner's half of sharing: the address the diary gets, and the keys handed
 * out to it.
 *
 * What matters here is that every link says what it lets through - which days,
 * whether pictures are part of it, how often it has been opened and what
 * stopped it - and that a link which has stopped keeps its row rather than
 * disappearing, because it is still a fact about what was sent out.
 */

const calls = vi.hoisted(() => ({
  visibility: [] as unknown[],
  revoked: [] as string[],
  removed: [] as string[],
}));

const mutation = (record?: (value: never) => void) => ({
  mutate: (value: never) => record?.(value),
  isPending: false,
  error: null,
});

const links = vi.hoisted(() => ({ items: [] as unknown[] }));

vi.mock('@/api/sharing', () => ({
  useShareLinks: () => ({ data: { items: links.items, nextCursor: null }, isPending: false }),
  useCreateShareLink: () => mutation(),
  useUpdateShareLink: () => mutation(),
  useRevokeShareLink: () => mutation(id => calls.revoked.push(id)),
  useDeleteShareLink: () => mutation(id => calls.removed.push(id)),
}));

vi.mock('@/api/grows', async importOriginal => ({
  ...(await importOriginal<object>()),
  useUpdateGrow: () => mutation(body => calls.visibility.push(body)),
}));

/**
 * The sheet reads the wall clock, because a link's counters age against it, so
 * the ages here are relative to now and the fixed dates sit at midday - where
 * no timezone can move them onto the day before.
 */
const NOW = DateTime.now();

const grow = {
  id: 'grow-1',
  name: 'Spring run',
  slug: 'spring-run',
  visibility: 'public',
} as GrowListItem;

const link = (over: Partial<ShareLink>): ShareLink => ({
  id: 'link-1',
  createdAt: NOW.minus({ days: 3 }).toISO()!,
  token: 'abcdef',
  kind: 'view',
  subject: { type: 'grow', id: 'grow-1' },
  range: { startsAt: '2026-09-01T12:00:00.000Z', endsAt: null },
  includeCameras: true,
  createdBy: 'user-1',
  expiresAt: null,
  revokedAt: null,
  state: { openCount: 3, lastOpenedAt: NOW.minus({ hours: 2 }).toISO()! },
  ...over,
});

const draw = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ShareSheet grow={grow} onClose={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  calls.visibility = [];
  calls.revoked = [];
  calls.removed = [];
  links.items = [link({})];
});

describe('the share sheet', () => {
  it('offers the diary’s own address while the page is on, and takes the page back on the same switch', () => {
    draw();

    expect(screen.getByText(/\/g\/spring-run$/)).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: 'Public page' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(toggle);
    expect(calls.visibility).toEqual([{ visibility: 'private' }]);
  });

  it('says of every link which days it reaches, whether pictures are part of it and how often it has been opened', () => {
    links.items = [link({ expiresAt: '2026-10-10T12:00:00.000Z' })];
    draw();

    expect(screen.getByText(/\/shared\/abcdef$/)).toBeInTheDocument();
    expect(screen.getByText(/from 1 Sep 2026 · with pictures · opened 3× · last 2 h ago · runs out 10 Oct 2026/)).toBeInTheDocument();
  });

  it('keeps a revoked link listed with the day it stopped, and offers neither its address nor a way to narrow it', () => {
    links.items = [link({ revokedAt: '2026-09-17T12:00:00.000Z', includeCameras: false })];
    draw();

    const row = screen.getByText(/without pictures/).closest('li')!;
    expect(row).toHaveAttribute('data-dead', 'true');
    expect(row).toHaveTextContent('revoked 17 Sep 2026');
    expect(within(row).queryByRole('button', { name: 'Copy the link' })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Narrow' })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });

  it('ends a link where it stands, and forgetting one is a second, separate thing', () => {
    draw();

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(calls.revoked).toEqual(['link-1']);
    expect(calls.removed).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Forget' }));
    expect(calls.removed).toEqual(['link-1']);
  });

  it('narrows a link by its window and its pictures, and never by what it points at', () => {
    draw();

    fireEvent.click(screen.getByRole('button', { name: 'Narrow' }));
    expect(screen.getAllByLabelText(/From|To|Expires/)).toHaveLength(3);
    expect(screen.getByRole('switch', { name: 'Camera pictures' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText('Spring run', { selector: 'select' })).not.toBeInTheDocument();
  });

  it('leaves out the links of other grows, because this sheet is about this diary', () => {
    links.items = [link({}), link({ id: 'link-2', token: 'zzz', subject: { type: 'grow', id: 'grow-2' } })];
    draw();

    expect(screen.getByText(/\/shared\/abcdef$/)).toBeInTheDocument();
    expect(screen.queryByText(/\/shared\/zzz$/)).not.toBeInTheDocument();
  });
});
