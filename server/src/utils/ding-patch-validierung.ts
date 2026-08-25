import { Ding } from '@fg2/shared-types';
import { DingProblem, T_MIN, T_SKEW_MS } from '@utils/ding-validierung';

/**
 * The four fields §15.1 lets a PATCH touch, and nothing else. Everything a Ding
 * says about the world - how much water, which stage, what the note reads - is
 * corrected by writing a new Ding that supersedes this one (§13.7), so the only
 * changes here are the ones that close a record rather than restate it.
 *
 * `validateDing` cannot do this job: it checks a create body, and it refuses
 * `storniert_von` outright as a server-owned field. A patch is the one moment
 * that field is written, which is why the two validators are separate.
 */
const OBEN = ['t_ende', 'storniert_von'];
/** Both live inside `d`, and each belongs to exactly one art. */
const IN_D: Record<string, Ding['art']> = { geschlossen_von: 'zustand', dublette_von: 'gabe' };

// The shape the validator demands of a client-minted ding_id. Every id a patch
// points at was minted by a client too.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * `aenderung` is the `$set` the patch amounts to, in dotted paths so the rest of
 * `d` survives untouched. Narrow with `pruefung.ok === false`: the server
 * compiles without `strictNullChecks`, where truthiness does not narrow a
 * boolean discriminant.
 */
export type DingPatchPruefung = { ok: true; aenderung: Record<string, unknown> } | { ok: false; problems: DingProblem[] };

const istObjekt = (wert: unknown): wert is Record<string, unknown> => typeof wert === 'object' && wert !== null && !Array.isArray(wert);

/** Checks a PATCH body against the Ding it is aimed at. Pure: no model, no database, no MQTT client. */
export function validateDingPatch(vorhandenes: Ding, eingabe: unknown): DingPatchPruefung {
  const problems: DingProblem[] = [];
  const nein = (path: string, message: string) => problems.push({ path: path, message: message });

  if (!istObjekt(eingabe)) {
    return { ok: false, problems: [{ path: '', message: 'must be an object' }] };
  }

  const aenderung: Record<string, unknown> = {};
  const erlaubt = `${OBEN.join(', ')}, d.${Object.keys(IN_D).join(', d.')}`;

  for (const key of Object.keys(eingabe)) {
    if (!OBEN.includes(key) && key !== 'd') {
      nein(key, `cannot be patched - a PATCH changes ${erlaubt}, and a value is corrected by writing a new Ding`);
    }
  }

  if (eingabe.t_ende !== undefined) {
    // Explicit null is not a closing time: it is how "still open" is written.
    if (eingabe.t_ende === null) {
      aenderung.t_ende = null;
    } else if (typeof eingabe.t_ende !== 'number' || !Number.isFinite(eingabe.t_ende)) {
      nein('t_ende', 'must be a finite epoch-ms number or null');
    } else if (eingabe.t_ende < T_MIN) {
      nein('t_ende', `must not be before ${new Date(T_MIN).toISOString()} - epoch seconds instead of milliseconds?`);
    } else if (eingabe.t_ende > Date.now() + T_SKEW_MS) {
      nein('t_ende', 'must not be more than a day in the future');
    } else if (eingabe.t_ende < vorhandenes.t) {
      nein('t_ende', 'must not precede t');
    } else {
      aenderung.t_ende = eingabe.t_ende;
    }
  }

  if (eingabe.storniert_von !== undefined) {
    if (typeof eingabe.storniert_von !== 'string' || !UUID_V4.test(eingabe.storniert_von)) {
      nein('storniert_von', 'must be the uuid v4 of the Ding that corrects this one');
    } else if (eingabe.storniert_von === vorhandenes.ding_id) {
      nein('storniert_von', 'must not be the Ding itself');
    } else {
      aenderung.storniert_von = eingabe.storniert_von;
    }
  }

  if (eingabe.d !== undefined) {
    if (!istObjekt(eingabe.d)) {
      nein('d', 'must be an object');
    } else {
      for (const [key, wert] of Object.entries(eingabe.d)) {
        if (!IN_D[key]) {
          nein(`d.${key}`, `cannot be patched - a PATCH changes d.${Object.keys(IN_D).join(', d.')} only`);
        } else if (IN_D[key] !== vorhandenes.art) {
          nein(`d.${key}`, `belongs to a ${IN_D[key]}, and this Ding is a ${vorhandenes.art}`);
        } else if (typeof wert !== 'string' || !UUID_V4.test(wert)) {
          nein(`d.${key}`, 'must be a uuid v4');
        } else {
          aenderung[`d.${key}`] = wert;
        }
      }
    }
  }

  if (problems.length > 0) return { ok: false, problems: problems };
  if (Object.keys(aenderung).length === 0)
    return { ok: false, problems: [{ path: '', message: `names nothing to change - a PATCH changes ${erlaubt}` }] };

  return { ok: true, aenderung: aenderung };
}
