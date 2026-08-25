/**
 * A device configuration is nested JSON; a `ZielStand` is one row per setpoint.
 * The key is the path with dots, which is the spelling §4.3 uses
 * (`day.temperature`, `daynight.day`, `lights.limit`) and the same one
 * `diffConfigs` writes into the log, so a target and the line announcing its
 * change name it identically.
 *
 * A setpoint is a scalar. A boolean is one too - `co2.sunsetOff` is as much a
 * setting as `co2.target` - and it travels as its own word rather than as 0/1,
 * because `ZielStand.wert` is a number or a string and `false` and `0` are not
 * the same answer. Anything else is not a value: an array or an object is a
 * branch, and `null` is a device saying nothing.
 *
 * A configuration that cannot be parsed yields nothing at all. It is a string
 * the device sent and never a promise, and half a set of targets would be
 * worse than none.
 */
export const flacheKonfiguration = (konfiguration?: string | null): Record<string, number | string> => {
  if (!konfiguration) {
    return {};
  }

  let wurzel: unknown;
  try {
    wurzel = JSON.parse(konfiguration);
  } catch {
    return {};
  }

  const flach: Record<string, number | string> = {};
  const gehe = (wert: unknown, pfad: string): void => {
    if (typeof wert === 'number' || typeof wert === 'string') {
      if (Number.isFinite(wert) || typeof wert === 'string') flach[pfad] = wert;
      return;
    }
    if (typeof wert === 'boolean') {
      flach[pfad] = String(wert);
      return;
    }
    if (wert === null || typeof wert !== 'object' || Array.isArray(wert)) {
      return;
    }

    for (const [schluessel, inhalt] of Object.entries(wert as Record<string, unknown>)) {
      gehe(inhalt, pfad ? `${pfad}.${schluessel}` : schluessel);
    }
  };

  gehe(wurzel, '');
  // The root itself is a scalar for a configuration that is just a number: it
  // has no key, so there is nothing to write a target under.
  delete flach[''];

  return flach;
};
