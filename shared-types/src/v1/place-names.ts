/**
 * One name, one place: an account's places that have not ended carry different
 * names, and so do its rooms. The server refuses a second one and numbers the
 * place it names itself; a screen says so before the write and names the place
 * it makes for a device the same way. Both read a name by these two functions,
 * so they cannot disagree about what "the same name" is.
 *
 * It carries no schema, so a client imports it without pulling zod in.
 */

/** A name as a person reads it: "Zelt", " zelt " and "ZELT" are one name. */
export const nameKey = (name: string): string => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * The name itself where it is free, else the name with the lowest number that
 * is: "Zelt", "Zelt 2", "Zelt 3". A name that already ends in a number counts
 * on from it - a second "Zelt 1" is "Zelt 2", not "Zelt 1 2". `taken` holds
 * the keys of the names in use.
 */
export const numbered = (name: string, taken: ReadonlySet<string>): string => {
  if (!taken.has(nameKey(name))) return name;

  const counted = /^(.*\S)\s+(\d{1,6})$/u.exec(name);
  const stem = counted ? counted[1] : name;
  for (let number = counted ? Number(counted[2]) + 1 : 2; ; number += 1) {
    const candidate = `${stem} ${number}`;
    if (!taken.has(nameKey(candidate))) return candidate;
  }
};
