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
export declare const nameKey: (name: string) => string;
/**
 * The name itself where it is free, else the name with the lowest number that
 * is: "Zelt", "Zelt 2", "Zelt 3". A name that already ends in a number counts
 * on from it - a second "Zelt 1" is "Zelt 2", not "Zelt 1 2". `taken` holds
 * the keys of the names in use.
 */
export declare const numbered: (name: string, taken: ReadonlySet<string>) => string;
