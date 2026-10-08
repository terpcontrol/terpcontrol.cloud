import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { AdvancedSection } from '@/ui/advanced/Advanced';
import { fieldValue } from '@/ui/advanced/field-values';
import { FieldNumber, FieldSwitch } from '@/ui/advanced/Fields';
import { advancedItem, type AdvancedItem } from '@/ui/advanced/item';
import { itemsFor } from '@/ui/advanced/registry';

/**
 * The Erweitert sections and what goes into them: an item is a file of its
 * own that the registry finds, a section with nothing to offer is not drawn,
 * and the controls an item is made of read a setting by the name the device's
 * type gives it and write it on the tap.
 */

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() },
}));

const fridge = (over: Partial<Device> = {}): Device =>
  ({
    id: 'fridge-1',
    type: 'fridge',
    configuration: { workmode: 'full', daynight: { minimalDehumidifierOffTime: 300 } },
    control: { running: true, drying: false, mode: 'standard', energySaving: true },
    state: { hardware: {} },
    ...over,
  }) as Device;

const wrap = (children: React.ReactNode) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>);

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => vi.mocked(api.patch).mockReset());

describe('the registry', () => {
  it('finds an item by its file alone, and offers it only where it applies', () => {
    const context = (device: Device) => ({ device, mayManage: true, offline: false });

    expect(itemsFor('device', context(fridge())).map(item => item.id)).toContain('operating-mode');
    // A tent controller germinates in the dark as a fridge does; only a light, a socket and a fan have no operating mode.
    expect(itemsFor('device', context(fridge({ type: 'controller' }))).map(item => item.id)).toContain('operating-mode');
    expect(itemsFor('device', context(fridge({ type: 'light', control: null }))).map(item => item.id)).not.toContain('operating-mode');
  });
});

describe('a section', () => {
  const ITEMS: AdvancedItem[] = [
    advancedItem({ scope: 'place', id: 'second', order: 20, shows: () => true, Item: () => <p>second</p> }),
    advancedItem({
      scope: 'place',
      id: 'first',
      order: 10,
      shows: ({ devices }) => devices.length > 0,
      Item: ({ spaceId }) => <p>first in {spaceId}</p>,
    }),
    advancedItem({ scope: 'charts', id: 'elsewhere', order: 0, shows: () => true, Item: () => <p>elsewhere</p> }),
  ];

  it('draws its items folded, in their order, with the context of its scope', () => {
    wrap(<AdvancedSection scope="place" context={{ spaceId: 'space-1', devices: [fridge()], mayManage: true }} items={ITEMS} />);

    const section = screen.getByText('Advanced').closest('details')!;
    expect(section).not.toHaveAttribute('open');
    expect([...section.querySelectorAll('p')].map(line => line.textContent)).toEqual([
      'What most growers never need, for this place.',
      'first in space-1',
      'second',
    ]);
    expect(screen.queryByText('elsewhere')).not.toBeInTheDocument();
  });

  it('is not drawn at all where none of its items applies', () => {
    const { container } = wrap(
      <AdvancedSection
        scope="place"
        context={{ spaceId: 'space-1', devices: [], mayManage: true }}
        items={ITEMS.filter(item => item.id === 'first')}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe('the controls an item is made of', () => {
  it('reads the work mode from what the server says, and a figure from its place in the document', () => {
    expect(fieldValue(fridge(), 'energySaving')).toBe(true);
    expect(fieldValue(fridge(), 'mode')).toBe('standard');
    expect(fieldValue(fridge(), 'compressorRest')).toBe(300);
    expect(fieldValue(fridge(), 'nothingCalledThis')).toBeNull();
  });

  it('writes a switch on the tap, by its name', async () => {
    vi.mocked(api.patch).mockResolvedValue(fridge() as never);
    wrap(<FieldSwitch device={fridge()} name="energySaving" label="Energy saving" />);

    const toggle = screen.getByRole('switch', { name: 'Energy saving' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/fridge-1/configuration', { set: { energySaving: false } }));
  });

  it('saves a figure only once it is typed whole and inside the range the type allows', async () => {
    vi.mocked(api.patch).mockResolvedValue(fridge() as never);
    wrap(<FieldNumber device={fridge()} name="compressorRest" label="Compressor rest" unit="s" />);

    const field = screen.getByRole('textbox', { name: 'Compressor rest' });
    expect(field).toHaveValue('300');

    fireEvent.change(field, { target: { value: '120' } });
    expect(screen.getByText('From 240 to 900 s.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    fireEvent.change(field, { target: { value: '480' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/fridge-1/configuration', { set: { compressorRest: 480 } }));
  });
});
