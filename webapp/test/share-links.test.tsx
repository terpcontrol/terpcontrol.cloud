import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { DateTime } from 'luxon';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GrowListItem, Me, ShareLink, ShareLinkCreate, Space } from '@fg2/shared-types/v1';
import { NewLinkSheet } from '@/screens/me/sharing/NewLinkSheet';
import { ShareLinks } from '@/screens/me/sharing/ShareLinks';
import type { Told } from '@/log/log-context';
import { drawAt, json, NOT_FOUND } from './harness';
import { Toast } from './toast';
import { translate } from './translations';

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

/**
 * The page sorts a card by comparing its end with the clock, so the fixtures
 * sit relative to now, at midday where no zone moves the day. The clock itself
 * is held on one day in September: a link revoked 20 days ago is dated with its
 * year once that falls in the year before, which a case run in the first weeks
 * of January would read as a wrong date. Only Date is faked, so every timer
 * still runs.
 */
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(DateTime.fromISO('2026-09-24T12:00:00').toJSDate());
afterAll(() => vi.useRealTimers());

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
  // A room groups places and is no subject of a link.
  { id: 'room-1', ownerId: 'user-1', name: 'Workshop', kind: 'room' },
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

const server = {
  links: [] as ShareLink[],
  created: [] as ShareLinkCreate[],
  revoked: [] as string[],
  forgotten: [] as string[],
  /** Rows per page of `/grows` and `/spaces`; nought answers the whole list at once, as this install's does today. */
  pageSize: 0,
  /** Whether this account owns anything at all: two in five of the restored database own neither a tent nor a grow. */
  owns: true,
  failing: [] as string[],
  asked: [] as string[],
  /** The places a camera of the account stands in. */
  cameras: ['space-1'] as string[],
};

/** The server's own paging, reproduced: a page of `pageSize` rows and the cursor for the rest, which is the shape an owner past fifty tents gets. */
const pageOf = <T extends { id: string }>(rows: T[], url: URL) => {
  if (server.pageSize < 1) return { items: rows, nextCursor: null };
  const cursor = url.searchParams.get('cursor');
  const from = cursor ? rows.findIndex(row => row.id === cursor) + 1 : 0;
  const items = rows.slice(from, from + server.pageSize);
  const more = from + server.pageSize < rows.length;

  return { items, nextCursor: more && items.length > 0 ? items[items.length - 1].id : null };
};

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(String(input), 'http://localhost');
  const path = url.pathname.replace(/^\/v1/, '');
  const method = init?.method ?? 'GET';
  server.asked.push(`${path}${url.search}`);
  if (server.failing.includes(path)) return json({ status: 500, code: 'server_error', title: 'Server error', detail: '', errors: [] }, 500);

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
  if (path === '/grows') return json(pageOf(server.owns ? grows : [], url));
  if (path === '/spaces') return json(pageOf(server.owns ? spaces : [], url));
  if (path === '/me') return json(me);
  if (path === '/cameras') return json({ items: server.cameras.map(spaceId => ({ id: `camera-${spaceId}`, spaceId })), nextCursor: null });
  return json(NOT_FOUND, 404);
}) as unknown as typeof fetch;

let told: Told[] = [];

const draw = (at = '/me/share-links') =>
  drawAt(
    <Toast told={told}>
      <ShareLinks />
    </Toast>,
    { at },
  );

const drawLoaded = async () => {
  draw();
  await screen.findByText('Active');
  // The names come with two further reads; a card is not settled until they have.
  await waitFor(() => expect(screen.queryByText(/no longer here/)).not.toBeInTheDocument());
};

const card = (title: string, list?: string) =>
  (list ? within(screen.getByRole('list', { name: list })) : screen)
    .getByRole('button', { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })
    .closest('li')!;

beforeAll(() => translate());

beforeEach(() => {
  told = [];
  vi.stubGlobal('fetch', fetchStub);
  session.demo = false;
  server.links = [publicPage, weekView, revoked, expired];
  server.created = [];
  server.revoked = [];
  server.forgotten = [];
  server.pageSize = 0;
  server.owns = true;
  server.failing = [];
  server.asked = [];
  server.cameras = ['space-1'];
});

afterEach(() => vi.unstubAllGlobals());

/**
 * What a card is titled by is two further reads, and both of them are paged. An
 * owner with more tents than one page holds used to find every link past that
 * page titled "no longer here": a live key drawn as a dead one, on the screen
 * whose whole job is taking such a key back. So the lists are followed to their
 * last page, and a subject that has not turned up yet is said to be still
 * coming - "gone" is kept for the one case that has been proved.
 */
describe('a subject the first page does not hold', () => {
  it('follows the cursor and names a tent that only the second page holds', async () => {
    server.pageSize = 1;
    server.links = [link({ subject: { type: 'space', id: 'space-9' } })];
    await drawLoaded();

    expect(card("Mia's tent · Timeline")).toBeInTheDocument();
    expect(server.asked.filter(asked => asked.startsWith('/spaces')).length).toBeGreaterThan(1);
  });

  it('never calls a link gone while the list it is named from is still coming', async () => {
    server.pageSize = 1;
    server.links = [link({ subject: { type: 'space', id: 'space-9' } })];
    draw();

    await screen.findByText('Active');
    expect(screen.queryByText(/no longer here/)).not.toBeInTheDocument();
    await waitFor(() => expect(card("Mia's tent · Timeline")).toBeInTheDocument());
  });

  it('says the name could not be read when that list fails, rather than that the link has gone', async () => {
    server.failing = ['/spaces'];
    server.links = [link({})];
    draw();

    await waitFor(() => expect(card('Could not load. · Timeline')).toBeInTheDocument());
    expect(screen.queryByText(/no longer here/)).not.toBeInTheDocument();
  });

  it('states nothing about a grow whose visibility nobody has answered', async () => {
    server.failing = ['/grows'];
    server.links = [orphanPage];
    draw();

    const gone = await waitFor(() => card('Could not load. · public page'));
    expect(gone).not.toHaveTextContent('grow now private');
    expect(gone).not.toHaveTextContent('the grow’s permanent link');
  });

  it('still calls a link gone once both lists have been read to their end without it', async () => {
    server.links = [link({ subject: { type: 'space', id: 'space-404' } })];
    draw();

    await waitFor(() => expect(card('no longer here · Timeline')).toBeInTheDocument());
  });
});

describe('the active list', () => {
  it('draws both kinds with their count, each saying what it grants from the server’s own figures', async () => {
    await drawLoaded();

    const active = screen.getByRole('list', { name: 'Active' });
    expect(within(active).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Active').nextElementSibling).toHaveTextContent('2');

    const page = card('Spring run #3 · public page');
    expect(page).toHaveTextContent('the grow’s permanent link · camera pictures on · weights hidden · 41 opens · last 2 h ago');
    expect(page).not.toHaveAttribute('data-dead');

    // How long it lasts is said once, by the day it ends: "for 7 days" in the title said it again.
    const week = card('Tent 1 · Timeline', 'Active');
    expect(within(week).getByRole('button', { name: /^Tent 1 · Timeline/ }).firstElementChild).toHaveTextContent(/^Tent 1 · Timeline$/);
    expect(week).toHaveTextContent(
      `read-only view · expires ${dayOf(weekView.expiresAt!)} · camera pictures on · weights hidden · 6 opens · last 5 min ago`,
    );
    // A date is one word to a line.
    expect(week.textContent).toContain(`expires ${dayOf(weekView.expiresAt!).replace(' ', '\u00a0')}`);
    expect(within(week).getByRole('button', { name: 'Copy the link' })).toBeInTheDocument();
  });

  it('leads back to all grows, which is where it is reached from, rather than to Me', async () => {
    await drawLoaded();

    expect(screen.getByRole('link', { name: 'Back to all grows' })).toHaveAttribute('href', '/grows');
  });

  it('says a link nobody has opened has not been opened, rather than counting a zero', async () => {
    server.links = [link({ includeCameras: false })];
    await drawLoaded();

    expect(card('Tent 1 · Timeline')).toHaveTextContent('read-only view · permanent · camera pictures off · weights hidden · not opened yet');
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
        'Two kinds: the public page of a grow (permanent until you make the grow private) and a read-only view of a place or a time range with an expiry. Both can include the camera pictures or not. Followers see the public page; a link never grants writing.',
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

    const gone = within(dead)
      .getAllByRole('listitem')
      .find(row => row.textContent?.includes('expired'))!;
    expect(within(gone).getByRole('button')).toHaveAccessibleName(/^Tent 1 · Timeline/);
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
    fireEvent.click(within(screen.getByRole('list', { name: 'Active' })).getByRole('button', { name: /^Tent 1 · Timeline/ }));

    const sheet = screen.getByRole('dialog', { name: 'Tent 1 · Timeline' });
    expect(within(sheet).getByText(/\/shared\/tok-week$/)).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Forget' })).not.toBeInTheDocument();
    // What it will do, to whom, and that there is no way back to a live link.
    expect(within(sheet).getByText(/it cannot be started again – sharing once more takes a new link/)).toBeInTheDocument();

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
    fireEvent.click(within(card('Tent 1 · Timeline', 'Active')).getByRole('button', { name: 'Copy the link' }));
    await screen.findByText('Copy it by hand');
  });
});

/**
 * A link is made onto something this account owns, so an account that owns
 * nothing has nothing to make one from. The card was live all the same: it
 * opened the whole sheet, let four choices be made, and refused at the last
 * step with a dead Create link - where the rule is that a control somebody
 * cannot use is absent rather than refused after the tap.
 */
describe('an account with nothing of its own', () => {
  it('is told why there is no new link to make, rather than offered one that refuses', async () => {
    server.owns = false;
    server.links = [];
    await drawLoaded();

    expect(screen.getByText('Nothing of your own to share yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^\+ New link/ })).not.toBeInTheDocument();
  });

  it('keeps the card while the lists are still on their way, since a list that has not answered is not an empty account', async () => {
    server.failing = ['/spaces'];
    await drawLoaded();

    expect(screen.getByRole('button', { name: /^\+ New link/ })).toBeDisabled();
    expect(screen.queryByText('Nothing of your own to share yet')).not.toBeInTheDocument();
  });
});

describe('the new-link sheet', () => {
  const open = async () => {
    await drawLoaded();
    fireEvent.click(screen.getByRole('button', { name: '+ New link · grow or place · camera pictures · expiry' }));
    return screen.getByRole('dialog', { name: 'New link' });
  };

  /** "Freigabelink erstellen ›" on a place's edit page led to the list, whose sheet then chose a grow. */
  it('opens on the place a place´s page asked for, offered first and chosen', async () => {
    draw('/me/share-links?place=space-1');

    const sheet = await screen.findByRole('dialog', { name: 'New link' });
    const subjects = within(sheet).getByRole('group', { name: 'Grow or place' });
    expect(within(subjects).getAllByRole('button')[0]).toHaveTextContent('Tent 1');
    expect(within(subjects).getByRole('button', { name: 'Tent 1' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers only what this account owns, grows and places and no room, and starts on a read-only view for a week', async () => {
    const sheet = await open();

    const subjects = within(sheet).getByRole('group', { name: 'Grow or place' });
    expect(
      within(subjects)
        .getAllByRole('button')
        .map(button => button.textContent),
    ).toEqual(['Spring run #3', 'Balcony tomatoes', 'Tent 1']);
    expect(within(sheet).getByRole('button', { name: 'Read-only view' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(sheet).getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(await within(sheet).findByRole('switch', { name: 'Camera pictures' })).toHaveAttribute('aria-checked', 'false');
  });

  it('writes exactly the body the contract names, and no range of its own', async () => {
    const sheet = await open();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Tent 1' }));
    fireEvent.click(await within(sheet).findByText('Camera pictures'));
    expect(within(sheet).getByRole('switch', { name: 'Camera pictures' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(sheet).getByRole('button', { name: '30 days' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create link' }));

    await waitFor(() => expect(server.created).toHaveLength(1));
    const body = server.created[0];
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'includeCameras', 'kind', 'subject']);
    expect(body).toMatchObject({ kind: 'view', subject: { type: 'space', id: 'space-1' }, includeCameras: true });
    expect(Math.abs(DateTime.fromISO(body.expiresAt!).diff(NOW.plus({ days: 30 }), 'minutes').minutes)).toBeLessThan(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Made, it answers: the sheet is gone and the card may be far down the list.
    expect(told).toEqual([{ label: 'Link created · Tent 1', undo: null }]);
  });

  /** "camera pictures off" stood on the card of a link onto a place no camera has ever stood in. */
  it('says nothing of camera pictures on the card of a link onto a place without a camera', async () => {
    server.cameras = [];
    server.links = [weekView];
    await drawLoaded();

    await waitFor(() => expect(server.asked).toContain('/cameras'));
    await waitFor(() => expect(card('Tent 1 · Timeline', 'Active')).not.toHaveTextContent('camera pictures'));
    expect(card('Tent 1 · Timeline', 'Active')).toHaveTextContent(`read-only view · expires ${dayOf(weekView.expiresAt!)} · weights hidden`);
  });

  it('offers camera pictures only where a camera stands, and switches them from the words too', async () => {
    server.cameras = [];
    const sheet = await open();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Tent 1' }));
    await waitFor(() => expect(server.asked).toContain('/cameras'));
    expect(within(sheet).queryByRole('switch', { name: 'Camera pictures' })).not.toBeInTheDocument();
  });

  it('makes a public page permanent by sentence rather than by date, and never onto a grow that is private', async () => {
    const sheet = await open();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Balcony tomatoes' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Public page' }));
    expect(within(sheet).getByText(/Balcony tomatoes is private/)).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'Privacy and profile' })).toHaveAttribute('href', '/me/privacy');
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

/** Opened from Verlauf: the window on screen is named, and the place - whose curves they are - is offered first. */
describe('the new-link sheet from Verlauf', () => {
  const window = { startsAt: daysFromNow(-1), endsAt: NOW.toUTC().toISO()!, label: 'Yesterday 12:00 to today 12:00' };
  const openFrom = (fixed: boolean) =>
    drawAt(
      <Toast told={told}>
        <NewLinkSheet
          grows={[grows[0]]}
          spaces={spaces.filter(space => space.ownerId === 'user-1')}
          window={{ ...window, fixed }}
          first="space"
          onClose={() => undefined}
        />
      </Toast>,
    );

  it('chooses the place, names the window and holds the link to it once somebody chose that window', async () => {
    openFrom(true);
    const sheet = screen.getByRole('dialog', { name: 'New link' });

    expect(
      within(within(sheet).getByRole('group', { name: 'Grow or place' }))
        .getAllByRole('button')
        .map(button => button.textContent),
    ).toEqual(['Tent 1', 'Spring run #3']);
    expect(within(sheet).getByRole('button', { name: 'Tent 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(sheet).getByRole('button', { name: window.label })).toHaveAttribute('aria-pressed', 'true');
    expect(within(sheet).getByText('The link shows this time span only: its curves and its entries.')).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Create link' }));
    await waitFor(() => expect(server.created).toHaveLength(1));
    expect(server.created[0]).toMatchObject({
      subject: { type: 'space', id: 'space-1' },
      range: { startsAt: window.startsAt, endsAt: window.endsAt },
    });
  });

  it('names a window that ends now as well, and leaves the link unbounded until it is chosen', () => {
    openFrom(false);
    const sheet = screen.getByRole('dialog', { name: 'New link' });

    expect(within(sheet).getByRole('button', { name: window.label })).toHaveAttribute('aria-pressed', 'false');
    expect(within(sheet).getByRole('button', { name: 'No limit' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(sheet).getByText('The link shows the place as it is now, and everything before.')).toBeInTheDocument();

    // A grow without a limit is its diary as it goes on.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Spring run #3' }));
    expect(within(sheet).getByText('The link shows the grow’s diary as it goes on.')).toBeInTheDocument();
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
