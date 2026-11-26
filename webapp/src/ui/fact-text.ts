/**
 * What `Facts` is fed with: a sentence taken apart at its dots, and a figure
 * bound to its unit.
 */

/** A sentence written with " · " between its parts, set as the facts it is made of. */
export const factsOf = (text: string): string[] => text.split(' · ');

/**
 * A figure bound to the unit after it, for words that stand in running text:
 * "11,5 °C zu hoch" may break after the unit and never between "11,5" and "°C".
 * A unit is a sign or up to three letters - °C, %, ppm, kPa, Min, Std - so a
 * figure before a word ("2 Tage") is left to break as words do.
 */
export const unbroken = (text: string): string => text.replace(/(\d) (?=[°%µ]|[a-zA-Z]{1,3}(?![a-zA-Z]))/g, '$1\u00a0');
