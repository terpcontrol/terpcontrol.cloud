import { screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device } from '@fg2/shared-types/v1';
import { configurationFieldsOf } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { api } from '@/api/client';
import { useSettings } from '@/screens/control/climate/saved';
import { ChoiceSetting, NumberSetting, SettingsBlock, SwitchSetting } from '@/screens/control/devices/Settings';
import { AdvancedSection } from '@/ui/advanced/Advanced';
import { fieldValue, heldSetting } from '@/ui/advanced/field-values';
import { advancedItem, type AdvancedItem } from '@/ui/advanced/item';
import { itemsFor } from '@/ui/advanced/registry';
import { drawAt } from './harness';
import { Toast } from './toast';
import { translate } from './translations';

/**
 * The Erweitert sections and what goes into them: an item is a file of its
 * own that the registry finds, a section with nothing to offer is not drawn,
 * and the lines an item is made of read a setting by the name the device's
 * type gives it. How they write - the value sheet, the tap, the toast, a
 * silent device - is `fine-settings.test.tsx` and `standalone-panels.test.tsx`.
 */

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
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

beforeAll(() => translate());

beforeEach(() => {
  vi.mocked(api.patch).mockReset();
  vi.mocked(api.get).mockRejectedValue(new Error('no stub'));
});

describe('the registry', () => {
  it('finds an item by its file alone, and offers it only where it applies', () => {
    const context = (device: Device) => ({ device, mayManage: true, offline: false });

    expect(itemsFor('device', context(fridge())).map(item => item.id)).toContain('compressor-rest');
    // A compressor is a fridge's: a tent controller and a lamp have none to rest.
    expect(itemsFor('device', context(fridge({ type: 'controller' }))).map(item => item.id)).not.toContain('compressor-rest');
    expect(itemsFor('device', context(fridge({ type: 'light', control: null }))).map(item => item.id)).not.toContain('compressor-rest');
  });
});

describe('a section', () => {
  const ITEMS: AdvancedItem[] = [
    advancedItem({ scope: 'device', id: 'second', order: 20, shows: () => true, Item: () => <p>second</p> }),
    advancedItem({
      scope: 'device',
      id: 'first',
      order: 10,
      shows: ({ mayManage }) => mayManage,
      Item: ({ device }) => <p>first of {device.id}</p>,
    }),
  ];
  const context = (mayManage: boolean) => ({ device: fridge(), mayManage, offline: false });

  it('draws its items folded, in their order, with the context of its scope', () => {
    drawAt(<AdvancedSection scope="device" context={context(true)} items={ITEMS} />);

    const section = screen.getByText('Advanced').closest('details')!;
    expect(section).not.toHaveAttribute('open');
    // Nothing is explained over the items: each says what it is behind its own help.
    expect([...section.querySelectorAll('p')].map(line => line.textContent)).toEqual(['first of fridge-1', 'second']);
  });

  it('is not drawn at all where none of its items applies', () => {
    const { container } = drawAt(<AdvancedSection scope="device" context={context(false)} items={ITEMS.filter(item => item.id === 'first')} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe('the lines an item is made of', () => {
  it('read the work mode from what the server says, and a figure from its place in the document', () => {
    expect(fieldValue(fridge(), 'energySaving')).toBe(true);
    expect(fieldValue(fridge(), 'mode')).toBe('standard');
    expect(fieldValue(fridge(), 'compressorRest')).toBe(300);
    expect(fieldValue(fridge(), 'nothingCalledThis')).toBeNull();
  });

  /** The server says what a silent device holds as the diary line of the change wrote it. */
  it('read what a silent device was last handed as the setting itself is read', () => {
    const plug = configurationFieldsOf('plug');
    const fan = configurationFieldsOf('fan');

    expect(heldSetting(plug.overheatAt, 30.5)).toBe(30.5);
    expect(heldSetting(plug.dayNight, 'false')).toBe(false);
    expect(heldSetting(plug.dayNight, 1)).toBe(true);
    expect(heldSetting(plug.plugMode, 'heater')).toBe('heater');
    expect(heldSetting(fan.fanMode, 2)).toBe('humidity');
    expect(heldSetting(plug.timerWindows, '[{"ontime":36000,"duration":10}]')).toEqual([{ ontime: 36000, duration: 10 }]);
    expect(heldSetting(plug.overheatAt, null)).toBeNull();
  });

  /** A control the reader may not use is absent: the settings are read as text. */
  it('are text, and no control, for whoever may not manage the device', () => {
    function Lines({ device }: { device: Device }) {
      const settings = useSettings(device);
      const shared = { device, settings, mayManage: false };
      return (
        <SettingsBlock label="Fine">
          <NumberSetting {...shared} name="compressorRest" label="Compressor rest" unit="s" />
          <SwitchSetting {...shared} name="energySaving" label="Energy saving" />
          <ChoiceSetting {...shared} name="mode" label="Operating mode" options={[{ value: 'standard', label: 'Standard' }]} />
        </SettingsBlock>
      );
    }
    drawAt(
      <Toast>
        <Lines device={fridge({ state: { hardware: {}, lastSeenAt: new Date().toISOString() } as Device['state'] })} />
      </Toast>,
    );

    expect(screen.getByRole('region', { name: 'Fine' })).toHaveTextContent('Compressor rest300 sEnergy savingonOperating modeStandard');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});
