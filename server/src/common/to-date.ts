// Epoch milliseconds have twelve digits or more from September 2001 onwards, so
// nothing this server will be sent is shorter. A shorter run of digits is
// something else - a bare year, most likely - and `new Date` reads those the
// way the sender meant them.
const EPOCH_MILLISECONDS = /^\d{12,}$/;

/**
 * When a client says something happened. The app sends epoch milliseconds, the
 * device an ISO timestamp, and a client that builds its query string by hand
 * sends those milliseconds as a string - which `new Date` alone reads as no
 * date at all.
 */
export const toDate = (time: string | number | Date | undefined | null): Date | undefined => {
  if (!time) return undefined;
  if (typeof time === 'string' && EPOCH_MILLISECONDS.test(time)) return new Date(Number(time));

  return new Date(time);
};

/** Whether `toDate` can make a moment of it, which is what the diary is sorted by. */
export const namesAMoment = (time: string | number): boolean => {
  const date = toDate(time);
  return !!date && !Number.isNaN(date.getTime());
};
