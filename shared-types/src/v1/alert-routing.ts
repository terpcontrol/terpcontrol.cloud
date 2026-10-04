import type { z } from 'zod';
import type { notificationCategory } from './accounts.js';
import type { severity } from './common.js';

type Severity = z.infer<typeof severity>;
type NotificationCategory = z.infer<typeof notificationCategory>;

/**
 * Which row of the routing grid an alarm falls in, decided once for both ends.
 *
 * The server announces by it and the alarm rules page says by it where a rule
 * will go, so it is the contract's rather than either side's - a copy in each
 * would be two answers to the same question. Critical alarms are `alerts`,
 * wanted where they wake somebody; warnings are `warnings`, read in the
 * morning; an info rule is in neither row and stays in the inbox. Like
 * `VALUE_AGE`, this module carries no schema, so a client imports it on its
 * own without pulling zod in.
 */
export const alertCategory = (severity: Severity): NotificationCategory | null =>
  severity === 'critical' ? 'alerts' : severity === 'warning' ? 'warnings' : null;
