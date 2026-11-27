/**
 * The harvest sheet weighs what came down, while the model keeps a weight per
 * plant so that a staggered harvest adds up rather than being counted twice.
 * So the figure is shared out evenly over the plants it was weighed for, and the
 * last of them takes whatever rounding left over, which keeps the total exactly
 * what somebody typed in - at the harvest and when its line's weights are
 * corrected. A plant that really weighed something else is corrected on the
 * plant, which is what `PATCH /plants/{id}` is for.
 */
export const shareOut = (total: number | null, count: number): (number | null)[] => {
  if (total === null || count === 0) return Array.from({ length: count }, () => null);

  const each = round(total / count);
  return Array.from({ length: count }, (_, index) => (index < count - 1 ? each : round(total - each * (count - 1))));
};

/** A weight to the hundredth of a gram, which is finer than any scale a grower has. */
export const round = (value: number): number => Math.round(value * 100) / 100;
