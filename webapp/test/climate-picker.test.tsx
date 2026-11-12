import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClimatePicker } from '@/screens/timeline/ClimatePicker';
import { drawAt } from './harness';
import { ago, fetchStub, fridge, overviewOf, resetServer, server, setpoints, values } from './place-wire';
import { translate } from './translations';

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
});

/**
 * Verlauf and Graphen of a place that still holds several climates - a tent
 * controller and a fridge module stood together - can be narrowed to one of
 * them, or draw every device together. Start lets the first of them speak.
 */
describe('a place holding several climates', () => {
  const twoClimates = () =>
    overviewOf({
      deviceIds: ['device-1', 'device-2'],
      climates: [
        { deviceId: 'device-1', values: values(), setpoints, targets: overviewOf().targets, verdict: overviewOf().verdict },
        {
          deviceId: 'device-2',
          values: [{ metric: 'temperature', value: 20.6, measuredAt: ago(0.3), state: 'live' }],
          setpoints: [{ metric: 'temperature', value: 25, band: 1 }],
          targets: { day: [{ metric: 'temperature', value: 25, band: 1 }], night: [] },
          verdict: { ...overviewOf().verdict, deviceId: 'device-2' },
        },
      ],
    });

  beforeAll(() => translate());

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchStub);
    resetServer();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('offers to draw one climate of several on its own, and every device together', async () => {
    server.devices = [fridge(), fridge({ id: 'device-2', type: 'controller', name: 'Mother controller' })];
    server.overviews.set('space-1', twoClimates());
    const chosen = vi.fn();
    drawAt(<ClimatePicker spaceId="space-1" chosen={null} onChoose={chosen} />);

    const picker = await screen.findByRole('group', { name: 'Which device' });
    expect(within(picker).getByRole('button', { name: 'All devices' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(await within(picker).findByRole('button', { name: 'Mother controller' }));
    expect(chosen).toHaveBeenCalledWith('device-2');
  });

  it('offers no choice where the place holds one climate', async () => {
    server.overviews.set('space-1', overviewOf({ climates: [twoClimates().climates[0]] }));
    drawAt(<ClimatePicker spaceId="space-1" chosen={null} onChoose={() => {}} />);

    await waitFor(() => expect(server.calls).toContain('GET /spaces/space-1/overview'));
    expect(screen.queryByRole('group', { name: 'Which device' })).not.toBeInTheDocument();
  });
});
