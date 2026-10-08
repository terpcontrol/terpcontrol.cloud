/** Every step the old charts offered, finest first; "automatic" is the width of the window deciding. */
export const STEPS = [5, 10, 20, 60, 300, 900, 1800, 3600, 4 * 3600, 24 * 3600, 7 * 24 * 3600];

/** The units a step is written in, widest first, by the words the window chips beside them use ("7 Tage", "24 Std"). */
const STEP_UNITS = [
  { unit: 'd', seconds: 24 * 60 * 60 },
  { unit: 'h', seconds: 60 * 60 },
  { unit: 'min', seconds: 60 },
  { unit: 's', seconds: 1 },
];

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * How far apart the points are, in words.
 *
 * Not `spanLabel`, which floors to a single unit. That is right for an age - a
 * value an hour and a half old is "1 h ago", and saying "1 h 30 min ago" of it
 * would be precision nobody asked for - and wrong for a figure somebody is
 * about to count rows by: the step of a whole grow is whatever the window
 * divided by the number of panels comes to, 1 h 29 min on one of the restored
 * seasons, and floored to "1 h" the note was a third short of the truth.
 *
 * So the next unit down is named where there is one worth naming, and left off
 * where the step lands on a whole one of the first - which is every rolling
 * window, the two the chips offer included. A week is seven days.
 */
export const stepLabel = (seconds: number, t: Translate): string => {
  // Counted, so a language that writes a day out can say "1 Tag" and "7 Tage".
  const word = (unit: string, count: number) => t(`charts.stepUnit.${unit}`, { count });
  const whole = Math.max(0, Math.round(seconds));
  const index = Math.max(
    0,
    STEP_UNITS.findIndex(one => whole >= one.seconds),
  );
  const big = STEP_UNITS[index];
  const small = STEP_UNITS[index + 1];
  const count = Math.floor(whole / big.seconds);
  const rest = small ? Math.round((whole - count * big.seconds) / small.seconds) : 0;
  // A remainder that rounds up to a whole one of the unit above is that unit.
  if (small && rest * small.seconds >= big.seconds) return `${count + 1} ${word(big.unit, count + 1)}`;

  return rest > 0 ? `${count} ${word(big.unit, count)} ${rest} ${word(small.unit, rest)}` : `${count} ${word(big.unit, count)}`;
};
