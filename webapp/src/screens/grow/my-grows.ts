import type { MyGrowCard } from '@fg2/shared-types/v1';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Spaces that do not break, so a narrow card breaks a line between two dates or weights and never inside one. */
export const whole = (text: string): string => text.replace(/ /g, '\u00a0');

/** "2 laufend · 3 abgeschlossen", leaving out a half that holds nothing. */
export const countsOf = (t: Translate, grows: MyGrowCard[]): string => {
  const running = grows.filter(grow => grow.endedAt === null).length;
  const finished = grows.length - running;

  return [
    running > 0 ? t('grow.mine.runningCount', { count: running }) : null,
    finished > 0 ? t('grow.mine.finishedCount', { count: finished }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
};
