/**
 * Shown wherever a measurement is missing — an offline device, a sensor that
 * never reported. Anything is better than letting NaN reach the DOM.
 */
export const NO_VALUE = '—';

export const isMissingValue = (value: any): boolean => !Number.isFinite(parseFloat(value));
