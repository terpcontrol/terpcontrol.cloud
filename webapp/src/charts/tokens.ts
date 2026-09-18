/**
 * A chart is drawn on a canvas, where a CSS variable cannot reach. This is the
 * one place that reads the tokens out of the document and hands them over as
 * plain colours, so `tokens.css` stays the only file a colour is written in.
 */

const TOKENS = [
  'ink',
  'muted',
  'label',
  'rule',
  'card',
  'card-2',
  'bg',
  'green',
  'brand',
  'wordmark',
  'temperature',
  'humidity',
  'co2',
  'warning',
  'alarm',
  'font-text',
  'font-mono',
] as const;

export type ChartToken = (typeof TOKENS)[number];

export type ChartPalette = Record<ChartToken, string>;

export const readChartPalette = (element: Element = document.documentElement): ChartPalette => {
  const style = getComputedStyle(element);
  return Object.fromEntries(TOKENS.map(token => [token, style.getPropertyValue(`--${token}`).trim()])) as ChartPalette;
};
