import type { CardValue, HomeSpaceCard, Severity, ValueState } from '@fg2/shared-types/v1';

/**
 * What the home decides about a card before it is drawn: how alive it is, how
 * much it needs a person, and how it should be ordered among the others. The
 * server has already decided the age of every value; this only reads those
 * verdicts off the card.
 */

/** A card's liveness: `none` is a place with nothing measuring in it, which shows no dot at all. */
export type Liveness = ValueState | 'none';

const RANK: Record<ValueState, number> = { live: 0, stale: 1, offline: 2 };

/** The best of its values - one live sensor is a live card. A device that has reported nothing yet is offline, not absent. */
export const livenessOf = (card: Pick<HomeSpaceCard, 'values' | 'deviceIds'>): Liveness => {
  if (card.deviceIds.length === 0) return 'none';
  if (card.values.length === 0) return 'offline';
  return card.values.reduce<ValueState>((best, value) => (RANK[value.state] < RANK[best] ? value.state : best), 'offline');
};

/** The newest instant on the card, which is what its age reads from. */
export const measuredAtOf = (values: CardValue[]): string | null =>
  values.reduce<string | null>((newest, value) => (value.measuredAt && (!newest || value.measuredAt > newest) ? value.measuredAt : newest), null);

const SEVERITY: Record<Severity, number> = { critical: 3, warning: 2, info: 1 };

/** How badly a card wants a person: an alarm first, then something due, then something offline. */
export const attentionOf = (card: HomeSpaceCard): number => {
  const alarm = Math.max(0, ...card.openAlerts.map(alert => SEVERITY[alert.severity] * 10));
  const due = card.dueTasks.length > 0 ? 5 : 0;
  const offline = livenessOf(card) === 'offline' ? 1 : 0;
  return alarm + due + offline;
};

/** The one alert that sets the card's tone. */
export const worstAlertOf = (card: HomeSpaceCard) =>
  card.openAlerts.reduce<HomeSpaceCard['openAlerts'][number] | null>(
    (worst, alert) => (worst && SEVERITY[worst.severity] >= SEVERITY[alert.severity] ? worst : alert),
    null,
  );

/** Stable: two cards that need nothing keep the order the server gave them, which is the order the places were set up in. */
export const sortedByAttention = (cards: HomeSpaceCard[]): HomeSpaceCard[] =>
  cards
    .map((card, index) => ({ card, index, attention: attentionOf(card) }))
    .sort((a, b) => b.attention - a.attention || a.index - b.index)
    .map(row => row.card);

/**
 * From when the home is a club's: places grouped under rooms, which a home
 * grower never has. Cards go compact; the order by attention is everybody's,
 * because an alarm belongs at the top of two cards as much as of twenty.
 */
export const isClub = (cards: HomeSpaceCard[]): boolean => cards.some(card => card.roomId !== null);
