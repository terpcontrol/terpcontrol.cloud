import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GrowListItem, Me, ShareLink, ShareLinkCreate, Space } from '@fg2/shared-types/v1';
import { ShareLinks } from '@/screens/me/sharing/ShareLinks';

/**
 * Me › Share links: every address handed out, and what each one lets through.
 *
 * What matters is that a card tells the truth about its link from the server's
 * own figures - the kind, the day it ends, whether the cams are in it, what the
 * privacy settings strip, how often it was opened - that a link which has
 * stopped is never drawn as if it worked, and that the sheet which makes one
 * writes exactly the body the contract names and no field it invented.
 */

const session = vi.hoisted(() => ({ demo: false }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => (session.demo ? ON_THE_DEMO : SIGNED_IN) };
});

/** The page sorts a card by comparing its end with the clock, so the fixtures sit relative to now, at midday where no zone moves the day. */
const NOW = DateTime.now();
const daysFromNow = (days: number) => NOW.plus({ days }).set({ hour: 12, minute: 0, second: 0, millisecond: 0 }).toUTC().toISO()!;
const dayOf = (at: string) => DateTime.fromISO(at).toFormat('d LLL');

const grows = [
  { id: 'grow-1', ownerId: 'user-1', name: 'Spring run #3', slug: 'spring-run-3', visibility: 'public' },
  { id: 'grow-2', ownerId: 'user-1', name: 'Balcony tomatoes', slug: 'balcony-tomatoes', visibility: 'private' },
  { id: 'grow-9', ownerId: 'user-mia', name: "Mia's grow", slug: 'mias-grow', visibility: 'public' },
] as GrowListItem[];

const spaces = [
  { id: 'space-1', ownerId: 'user-1', name: 'Tent 1', kind: 'tent' },
  { id: 'space-9', ownerId: 'user-mia', name: "Mia's tent", kind: 'tent' },
] as Space[];

const me = { handle: 'chrisgrows', publicProfile: true, privacy: { hideWeights: true, hideCounts: false } } as Me;

const link = (over: Partial<ShareLink>): ShareLink => ({
  id: 'link-1',
  createdAt: daysFromNow(-1),
  token: 'tok-1',
  kind: 'view',
  subject: { type: 'space', id: 'space-1' },
  range: { startsAt: null, endsAt: null },
  includeCameras: true,
  createdBy: 'user-1',
  expiresAt: null,
  revokedAt: null,
  state: { openCount: 0, lastOpenedAt: null },
  ...over,
});

const publicPage = link({
  id: 'link-page',
  token: 'tok-page',
  kind: 'public_page',
  subject: { type: 'grow', id: 'grow-1' },
  state: { openCount: 41, lastOpenedAt: NOW.minus({ hours: 2 }).toISO()! },
});

const weekView = link({
  id: 'link-week',
  token: 'tok-week',
  expiresAt: daysFromNow(6),
  state: { openCount: 6, lastOpenedAt: NOW.minus({ minutes: 5 }).toISO()! },
});

const revoked = link({
  id: 'link-revoked',
  token: 'tok-revoked',
  revokedAt: daysFromNow(-20),
  state: { openCount: 2, lastOpenedAt: daysFromNow(-21) },
});

const expired = link({ id: 'link-expired', token: 'tok-expired', createdAt: daysFromNow(-15), expiresAt: daysFromNow(-1) });

const orphanPage = link({ id: 'link-orphan', token: 'tok-orphan', kind: 'public_page', subject: { type: 'grow', id: 'grow-2' } });

const server = { links: [] as ShareLink[], created: [] as ShareLinkCreate[], revoked: [] as string[], forgotten: [] as string[] };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/v1/, '');
  const method = init?.method ?? 'GET';

  if (path === '/share-links' && method === 'GET') return json({ items: server.links, nextCursor: null });
  if (path === '/share-links' && method === 'POST') {
    const body = JSON.parse(String(init?.body)) as ShareLinkCreate;
    server.created.push(body);
    server.links = [link({ id: 'link-new', token: 'tok-new', ...body }), ...server.links];
    return json(server.links[0], 201);
  }
  const revocation = path.match(/^\/share-links\/([^/]+)\/revocation$/);
  if (revocation && method === 'PUT') {
    server.revoked.push(revocation[1]);
    server.links = server.links.map(row => (row.id === revocation[1] ? { ...row, revokedAt: NOW.toISO()! } : row));
    return json(server.links.find(row => row.id === revocation[1]));
  }
  const one = path.match(/^\/share-links\/([^/]+)$/);
  if (one && method === 'DELETE') {
    server.forgotten.push(one[1]);
    server.links = server.links.filter(row => row.id !== one[1]);
    return new Response(null, { status: 204 });
  }
  if (path === '/grows') return json({ items: grows, nextCursor: null });
  if (path === '/spaces') return json({ items: spaces, nextCursor: null });
  if (path === '/me') return json(me);
  return json({ status: 404, code: 'not_found', title: 'Not found', detail: '', errors: [] }, 404);
}) as unknown as typeof fetch;

const draw = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={['/me/share-links']}>
        <ShareLinks />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const drawLoaded = async () => {
  draw();
  await screen.findByText('Active');
  // The names come with two further reads; a card is not settled until they have.
  await waitFor(() => expect(screen.queryByText(/no longer here/)).not.toBeInTheDocument());
};

const card = (title: string) => screen.getByRole('button', { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).closest('li')!;

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8')) as Record<string, unknown>;
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  session.demo = false;
  server.links = [publicPage, weekView, revoked, expired];
  server.created = [];
  server.revoked = [];
  server.forgotten = [];
});

afterEach(() => vi.unstubAllGlobals());

describe('the active list', () => {
  it('draws both kinds with their count, each saying what it grants from the server’s own figures', async () => {
    await drawLoaded();

    const active = screen.getByRole('list', { name: 'Active' });
    expect(within(active).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Active').nextElementSibling).toHaveTextContent('2');

    const page = card('Spring run #3 · public page');
    expect(page).toHaveTextContent("the grow's permanent link · cams on · weights hidden · 41 opens · last 2 h ago");
    expect(page).not.toHaveAttribute('data-dead');

    const week = card('Tent 1 · timeline · 7 days');
    expect(week).toHaveTextContent(`read-only view · expires ${dayOf(weekView.expiresAt!)} · cams on · weights hidden · 6 opens · last 5 min ago`);
    expect(within(week).getByRole('button', { name: 'Copy the link' })).toBeInTheDocument();
  });

  it('says a link nobody has opened has not been opened, rather than counting a zero', async () => {
    server.links = [link({ includeCameras: false })];
    await drawLoaded();

    expect(card('Tent 1 · timeline')).toHaveTextContent('read-only view · permanent · cams off · weights hidden · not opened yet');
  });

  it('warns on a public-page link whose grow has gone private, because the server still answers it', async () => {
    server.links = [orphanPage];
    await drawLoaded();

    expect(card('Balcony tomatoes · public page')).toHaveTextContent('grow now private · does not open');
  });

  it('closes with the paragraph the board writes, word for word', async () => {
    await drawLoaded();

    expect(
      screen.getByText(
        'Two kinds: the public page of a grow (permanent until you make the grow private) and a read-only view of a tent or a time range with an expiry. Both can include the cams or not. Followers see the public page; a link never grants writing.',
      ),
    ).toBeInTheDocument();
  });
});

describe('links that have stopped', () => {
  it('sorts an expired and a revoked link under their own label, dated by the server, dimmed and without Copy', async () => {
    await drawLoaded();

    const dead = screen.getByRole('list', { name: 'Expired or revoked' });
    expect(within(dead).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Expired or revoked').nextElementSibling).toHaveTextContent('2');

    const gone = card('Tent 1 · timeline · 14 days');
    expect(gone).toHaveAttribute('data-dead');
    expect(gone).toHaveTextContent(`expired ${dayOf(expired.expiresAt!)} · not opened yet`);
    expect(within(gone).queryByRole('button', { name: 'Copy the link' })).not.toBeInTheDocument();

    const taken = within(dead)
      .getAllByRole('listitem')
      .find(row => row.textContent?.includes('revoked'))!;
    expect(taken).toHaveTextContent(`revoked ${dayOf(revoked.revokedAt!)} · 2 opens`);
    expect(taken).not.toHaveTextContent('expires');
  });

  it('draws no second label at all while nothing has stopped', async () => {
    server.links = [publicPage];
    await drawLoaded();

    expect(screen.queryByText('Expired or revoked')).not.toBeInTheDocument();
  });

  it('says so when nothing has been handed out', async () => {
    server.links = [];
    await drawLoaded();

    expect(screen.getByText('No links handed out yet')).toBeInTheDocument();
    expect(screen.getByText('Active').nextElementSibling).toHaveTextContent('0');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});

describe('a link’s own sheet', () => {
  it('shows the address of a live link and revokes it where it stands', async () => {
    await drawLoaded();
    fireEvent.click(screen.getByRole('button', { name: /^Tent 1 · timeline · 7 days/ }));

    const sheet = screen.getByRole('dialog', { name: 'Tent 1 · timeline · 7 days' });
    expect(within(sheet).getByText(/\/shared\/tok-week$/)).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Forget' })).not.toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(server.revoked).toEqual(['link-week']));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(server.forgotten).toEqual([]);
  });

  it('offers a dead link neither its address nor Revoke, only Forget', async () => {
    await drawLoaded();
    const dead = screen.getByRole('list', { name: 'Expired or revoked' });
    fireEvent.click(
      within(dead)
        .getAllByRole('button')
        .find(button => button.textContent?.includes('revoked'))!,
    );

    const sheet = screen.getByRole('dialog');
    expect(within(sheet).queryByText(/\/shared\//)).not.toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Forget' }));
    await waitFor(() => expect(server.forgotten).toEqual(['link-revoked']));
  });
});

describe('copying', () => {
  it('says it copied when the clipboard took the address, and says so when it did not', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await drawLoaded();

    fireEvent.click(within(card('Spring run #3 · public page')).getByRole('button', { name: 'Copy the link' }));
    await screen.findByText('Copied');
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/shared\/tok-page$/));

    writeText.mockRejectedValueOnce(new Error('refused'));
    fireEvent.click(within(card('Tent 1 · timeline · 7 days')).getByRole('button', { name: 'Copy the link' }));
    await screen.findByText('Copy it by hand');
  });
});

describe('the new-link sheet', () => {
  const open = async () => {
    await drawLoaded();
    fireEvent.click(screen.getByRole('button', { name: '+ New link · grow or tent · cams · expiry' }));
    return screen.getByRole('dialog', { name: 'New link' });
  };

  it('offers only what this account owns, and starts on a read-only view for a week', async () => {
    const sheet = await open();

    const subjects = within(sheet).getByRole('group', { name: 'Grow or tent' });
    expect(
      within(subjects)
        .getAllByRole('button')
        .map(button => button.textContent),
    ).toEqual(['Spring run #3', 'Balcony tomatoes', 'Tent 1']);
    expect(within(sheet).getByRole('button', { name: 'Read-only view' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(sheet).getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(sheet).getByRole('switch', { name: 'Camera pictures' })).toHaveAttribute('aria-checked', 'false');
  });

  it('writes exactly the body the contract names, and no range of its own', async () => {
    const sheet = await open();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Tent 1' }));
    fireEvent.click(within(sheet).getByRole('switch', { name: 'Camera pictures' }));
    fireEvent.click(within(sheet).getByRole('button', { name: '30 days' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create link' }));

    await waitFor(() => expect(server.created).toHaveLength(1));
    const body = server.created[0];
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'includeCameras', 'kind', 'subject']);
    expect(body).toMatchObject({ kind: 'view', subject: { type: 'space', id: 'space-1' }, includeCameras: true });
    expect(Math.abs(DateTime.fromISO(body.expiresAt!).diff(NOW.plus({ days: 30 }), 'minutes').minutes)).toBeLessThan(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('makes a public page permanent by sentence rather than by date, and never onto a grow that is private', async () => {
    const sheet = await open();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Balcony tomatoes' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Public page' }));
    expect(within(sheet).getByText(/Balcony tomatoes is private/)).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'Public grows and profile' })).toHaveAttribute('href', '/me/public');
    expect(within(sheet).getByRole('button', { name: 'Create link' })).toBeDisabled();
    expect(within(sheet).queryByRole('button', { name: '7 days' })).not.toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Spring run #3' }));
    expect(within(sheet).getByText('Permanent until you make the grow private.')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create link' }));

    await waitFor(() => expect(server.created).toHaveLength(1));
    expect(server.created[0]).toEqual({ kind: 'public_page', subject: { type: 'grow', id: 'grow-1' }, includeCameras: false, expiresAt: null });
  });

  it('cannot offer a tent a public page, and falls back to a view when a tent is picked', async () => {
    const sheet = await open();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Public page' }));
    expect(within(sheet).getByRole('button', { name: 'Public page' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(within(sheet).getByRole('button', { name: 'Tent 1' }));
    expect(within(sheet).getByRole('button', { name: 'Public page' })).toBeDisabled();
    expect(within(sheet).getByRole('button', { name: 'Read-only view' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('the demo', () => {
  it('is told it has no links to hand out, and nothing is read for it', async () => {
    session.demo = true;
    draw();

    expect(await screen.findByText('The demo has no links of its own to hand out.')).toBeInTheDocument();
    expect(vi.mocked(fetchStub).mock.calls).toHaveLength(0);
  });
});
