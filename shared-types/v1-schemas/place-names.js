"use strict";
/**
 * One name, one place: an account's places that have not ended carry different
 * names, and so do its rooms. The server refuses a second one and numbers the
 * place it names itself; a screen says so before the write and names the place
 * it makes for a device the same way. Both read a name by these two functions,
 * so they cannot disagree about what "the same name" is.
 *
 * It carries no schema, so a client imports it without pulling zod in.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.numbered = exports.nameKey = void 0;
/** A name as a person reads it: "Zelt", " zelt " and "ZELT" are one name. */
const nameKey = (name) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
exports.nameKey = nameKey;
/**
 * The name itself where it is free, else the name with the lowest number that
 * is: "Zelt", "Zelt 2", "Zelt 3". A name that already ends in a number counts
 * on from it - a second "Zelt 1" is "Zelt 2", not "Zelt 1 2". `taken` holds
 * the keys of the names in use.
 */
const numbered = (name, taken) => {
    if (!taken.has((0, exports.nameKey)(name)))
        return name;
    const counted = /^(.*\S)\s+(\d{1,6})$/u.exec(name);
    const stem = counted ? counted[1] : name;
    for (let number = counted ? Number(counted[2]) + 1 : 2;; number += 1) {
        const candidate = `${stem} ${number}`;
        if (!taken.has((0, exports.nameKey)(candidate)))
            return candidate;
    }
};
exports.numbered = numbered;
