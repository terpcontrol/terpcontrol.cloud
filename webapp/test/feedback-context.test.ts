import type { Device, DevicePage } from '@fg2/shared-types/v1';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { queryClient } from '@/api/query-client';
import { session } from '@/api/session';
import { debugLines, PREFILL_PROVIDER, prefillFor, provideFeedbackContext } from '@/app/feedback-context';
import { SIGNED_IN } from './session';
import { translate } from './translations';

/**
 * A feedback report starts with what the app knows about where it was sent from - the account, the page, the ids in
 * it and the hardware it is about - under room for the reporter's own words. The issue is public, so the other half
 * is checked as carefully: nothing in an address that opens something on its own reaches it.
 */
const device = (id: string, spaceId: string | null, over: Partial<Device['state']> = {}): Device =>
  ({
    id,
    type: 'controller',
    spaceId,
    firmware: { channel: 'stable', targetId: null },
    state: { firmwareId: 'fw-1', lastSeenAt: '2026-11-25T22:00:00.000Z', ...over },
  }) as unknown as Device;

const DEVICES = [device('sim-a', 'space-1'), device('sim-b', 'space-1', { firmwareId: null, lastSeenAt: null }), device('sim-c', 'space-2')];

beforeAll(() => translate());

afterEach(() => {
  vi.restoreAllMocks();
  queryClient.clear();
});

describe('what a report says about where it came from', () => {
  it('names the account, the page and every device of the place on it', () => {
    vi.spyOn(session, 'snapshot').mockReturnValue(SIGNED_IN);

    const lines = debugLines({ pathname: '/spaces/space-1', search: '?focus=sim-a', params: { spaceId: 'space-1' } }, DEVICES);

    expect(lines[0]).toBe(`- user: ${SIGNED_IN.user!.id} · @${SIGNED_IN.user!.handle}`);
    expect(lines).toContain('- page: /spaces/space-1?focus=sim-a');
    expect(lines).toContain('- place: space-1');
    expect(lines).toContain('- device: sim-a · controller · fw fw-1 · channel stable · seen 2026-11-25T22:00:00.000Z');
    expect(lines).toContain('- device: sim-b · controller · fw unknown · channel stable · never seen');
    expect(lines.join('\n')).not.toContain('sim-c');
    expect(lines.at(-2)).toMatch(/^- app: v\d+\.\d+\.\d+ · test · api localhost:5081$/);
  });

  it('reads the place from the query where a tab carries it there, and a device page names only its device', () => {
    expect(debugLines({ pathname: '/control/targets', search: '?space=space-2', params: { page: 'targets' } }, DEVICES)).toContain(
      '- device: sim-c · controller · fw fw-1 · channel stable · seen 2026-11-25T22:00:00.000Z',
    );
    const page = debugLines({ pathname: '/devices/sim-b', search: '', params: { deviceId: 'sim-b' } }, DEVICES).join('\n');
    expect(page).toContain('- device: sim-b');
    expect(page).not.toContain('sim-a');
  });

  it('keeps a token or a code out of the public issue', () => {
    const lines = debugLines({ pathname: '/shared/secret-token', search: '?code=123&space=s', params: { token: 'secret-token' } }).join('\n');

    expect(lines).not.toContain('secret-token');
    expect(lines).not.toContain('123');
    expect(lines).toContain('- page: /shared/…?code=…&space=s');
  });

  it('says so when nobody is signed in', () => {
    expect(debugLines({ pathname: '/', search: '', params: {} })[0]).toBe('- user: not signed in');
  });
});

describe('the prefill BugDrop asks for', () => {
  it('leaves room for the reporter first, says the context is public, and is the same for every category', () => {
    queryClient.setQueryData<DevicePage>(['devices'], { items: DEVICES, nextCursor: null } as unknown as DevicePage);
    provideFeedbackContext(() => ({ pathname: '/spaces/space-2', search: '', params: { spaceId: 'space-2' } }));

    const { descriptionTemplates } = window[PREFILL_PROVIDER]!();

    expect(descriptionTemplates.bug.startsWith('\n\n#### Debug info for the developers. It goes into the public issue too')).toBe(true);
    expect(descriptionTemplates.bug).toContain('- device: sim-c');
    expect(descriptionTemplates.feature).toBe(descriptionTemplates.bug);
    expect(descriptionTemplates.question).toBe(descriptionTemplates.bug);
    expect(prefillFor({ pathname: '/', search: '', params: {} }).descriptionTemplates.bug.length).toBeLessThan(4000);
  });
});
