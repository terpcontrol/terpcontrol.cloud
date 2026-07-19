import { mergeConfiguration } from '@utils/mergeConfiguration';

const merge = (existing: string | undefined, incoming: string): unknown => JSON.parse(mergeConfiguration(existing, incoming));

describe('Configuration merge', () => {
  it('keeps settings the sender does not know about', () => {
    const existing = JSON.stringify({ heater: { hysteresis: 0.5, assistLead: 0.3 }, day: { temperature: 24 } });
    const incoming = JSON.stringify({ heater: { hysteresis: 0.5 }, day: { temperature: 26 } });

    expect(merge(existing, incoming)).toEqual({ heater: { hysteresis: 0.5, assistLead: 0.3 }, day: { temperature: 26 } });
  });

  it('lets the sender overwrite a setting it does know about', () => {
    const existing = JSON.stringify({ heater: { assistLead: 0.3 } });
    const incoming = JSON.stringify({ heater: { assistLead: 0 } });

    expect(merge(existing, incoming)).toEqual({ heater: { assistLead: 0 } });
  });

  it('adds settings that are new to the device', () => {
    const existing = JSON.stringify({ heater: { hysteresis: 0.5 } });
    const incoming = JSON.stringify({ heater: { hysteresis: 0.5, assistLead: 0.3 }, lights: { limit: 20 } });

    expect(merge(existing, incoming)).toEqual({ heater: { hysteresis: 0.5, assistLead: 0.3 }, lights: { limit: 20 } });
  });

  it('replaces arrays instead of merging them per index', () => {
    const existing = JSON.stringify({ steps: [1, 2, 3] });
    const incoming = JSON.stringify({ steps: [9] });

    expect(merge(existing, incoming)).toEqual({ steps: [9] });
  });

  it('takes the incoming config when there is nothing stored yet', () => {
    const incoming = JSON.stringify({ heater: { assistLead: 0.3 } });

    expect(merge('', incoming)).toEqual({ heater: { assistLead: 0.3 } });
    expect(merge(undefined, incoming)).toEqual({ heater: { assistLead: 0.3 } });
  });

  it('takes the incoming config when the stored one is unparseable', () => {
    const incoming = JSON.stringify({ heater: { assistLead: 0.3 } });

    expect(merge('not json', incoming)).toEqual({ heater: { assistLead: 0.3 } });
  });
});
