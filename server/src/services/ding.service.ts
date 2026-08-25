import { FilterQuery } from 'mongoose';
import { Ding, DingArt, DingeSeite, istGespeichert, Zelt } from '@fg2/shared-types';
import dingModel from '@models/ding.model';
import { projiziereDinge } from '@services/ding-adapter';
import { DingFenster } from '@services/ding-adapter/fenster';
import { DingCursor, kodiereCursor, vergleicheDinge } from '@utils/ding-cursor';
import { DingProblem } from '@utils/ding-validierung';

/** Neither the mongo id nor the schema version is part of a Ding. */
const OHNE_INTERNA = { _id: 0, __v: 0 };

/** Everything a client authors. `erfasst_at` and `storniert_von` are not here: the server owns the first, a PATCH the second. */
const KLIENT_FELDER: (keyof Ding)[] = ['zelt_id', 'art', 'name', 't', 't_ende', 'rel', 'd', 'bilder', 'akteur'];

/** The named edge that carries a `mensch`, and the two `d` fields that carry a ding_id. */
const VERWEIS_ART: Record<string, DingArt> = { akteur: 'mensch', 'd.dublette_von': 'gabe', 'd.geschlossen_von': 'mensch' };

interface Verweis {
  path: string;
  ding_id: string;
}

export interface DingSeitenAnfrage {
  zelt: Zelt;
  arten: DingArt[];
  von: number;
  bis: number;
  cursor: DingCursor | null;
  limit: number;
}

/**
 * Why a write did not happen. A conflict is not a validation failure: the Ding
 * is fine, it is the id that is already taken by a different one.
 */
export type DingSchreiben =
  | { ok: true; neu: boolean; ding: Ding }
  | { ok: false; grund: 'verweis'; problems: DingProblem[] }
  | { ok: false; grund: 'konflikt'; ding: Ding };

/**
 * A point happened at `t`; an interval is in the window as soon as it overlaps
 * it. The distinction is in the data rather than in a list of arts: a Ding with
 * `t_ende` is an interval, whichever art it is, and a Zustand opened in March
 * and still open belongs in today's window exactly as a device bound a year ago does.
 */
const fensterFilter = (von: number, bis: number): FilterQuery<Ding> => ({
  $or: [
    { t_ende: { $exists: false }, t: { $gte: von, $lte: bis } },
    // Explicit null is "still open", matched by type: a plain `t_ende: null`
    // would also match every Ding that has no `t_ende` at all.
    { t_ende: { $type: 'null' }, t: { $lte: bis } },
    { t_ende: { $gte: von }, t: { $lte: bis } },
  ],
});

/** The tail after the cursor, under the order `vergleicheDinge` defines and nothing else. */
const cursorFilter = (cursor: DingCursor | null): FilterQuery<Ding> =>
  cursor ? { $or: [{ t: { $lt: cursor.t } }, { t: cursor.t, ding_id: { $lt: cursor.ding_id } }] } : {};

/** Key order is not part of a Ding, so two writes that differ only in it are the same write. */
const stabil = (wert: unknown): unknown => {
  if (Array.isArray(wert)) return wert.map(stabil);
  if (wert === null || typeof wert !== 'object') return wert;

  return Object.keys(wert as Record<string, unknown>)
    .sort()
    .reduce((geordnet, key) => {
      const inhalt = (wert as Record<string, unknown>)[key];
      if (inhalt !== undefined) geordnet[key] = stabil(inhalt);
      return geordnet;
    }, {} as Record<string, unknown>);
};

const abdruck = (ding: Partial<Ding>): string =>
  JSON.stringify(stabil(KLIENT_FELDER.reduce((felder, feld) => ({ ...felder, [feld]: feld === 'name' ? ding.name ?? '' : ding[feld] }), {})));

class DingService {
  /**
   * One page of the tent's Dinge, stored and projected merged into one list.
   *
   * The projections are asked for the window clipped to the cursor, so paging
   * back through a long diary does not re-project the whole grow every page. One
   * row more than the page is read from mongo, which is what tells a full page
   * apart from the last one without asking a second time.
   */
  public async seite(anfrage: DingSeitenAnfrage): Promise<DingeSeite> {
    const { zelt, arten, von, bis, cursor, limit } = anfrage;
    const gespeichert = arten.filter(istGespeichert);
    const projiziert = arten.filter(art => !istGespeichert(art));
    const fenster: DingFenster = { zelt: zelt, von: von, bis: bis, limit: limit, cursor: cursor };

    const [gelesen, projizierte] = await Promise.all([
      gespeichert.length === 0
        ? Promise.resolve([] as Ding[])
        : (dingModel
            .find({ zelt_id: zelt.zelt_id, art: { $in: gespeichert }, $and: [fensterFilter(von, bis), cursorFilter(cursor)] }, OHNE_INTERNA)
            .sort({ t: -1, ding_id: -1 })
            .limit(limit + 1)
            .lean() as unknown as Promise<Ding[]>),
      projiziert.length === 0 ? Promise.resolve([] as Ding[]) : projiziereDinge(fenster, projiziert),
    ]);

    // Both halves are the page plus at most one row, so their merge is too, and
    // the row past the page is the whole answer to "is there another one".
    const zusammen = [...gelesen, ...projizierte].sort(vergleicheDinge);
    const dinge = zusammen.slice(0, limit);

    return { dinge: dinge, ...(zusammen.length > limit ? { cursor: kodiereCursor(dinge[dinge.length - 1]) } : {}) };
  }

  public async finde(ding_id: string): Promise<Ding | null> {
    if (!ding_id) return null;

    return dingModel.findOne({ ding_id: ding_id }, OHNE_INTERNA).lean() as unknown as Promise<Ding | null>;
  }

  /**
   * Writes a Ding, inserting it and only ever inserting it.
   *
   * `$setOnInsert` rather than `$set` is the whole promise of the collection: the
   * same watering sent three times over a bad connection is logged once, and a
   * *different* Ding arriving under an id that is taken cannot overwrite the one
   * already there. That is refused with a conflict instead of silently turning a
   * watering into a note, because a Ding is never edited - it is superseded by a
   * new one carrying `storniert_von`.
   *
   * `erfasst_at` is not written here. It means "when this was typed", the model
   * stamps it on insert, and a retry three minutes later did not retype it.
   */
  public async speichere(ding: Ding): Promise<DingSchreiben> {
    const problems = await this.pruefeVerweise(ding);
    if (problems.length > 0) return { ok: false, grund: 'verweis', problems: problems };

    const neu: Record<string, unknown> = {};
    for (const feld of KLIENT_FELDER) {
      const wert = feld === 'name' ? ding.name ?? '' : ding[feld];
      if (wert !== undefined) neu[feld] = wert;
    }

    // ding_id is not in the document: the filter's equality supplies it on insert.
    const ergebnis = await dingModel.updateOne({ ding_id: ding.ding_id }, { $setOnInsert: neu }, { upsert: true });
    const gespeichert = await this.finde(ding.ding_id);
    if (ergebnis.upsertedCount > 0) return { ok: true, neu: true, ding: gespeichert };

    if (abdruck(gespeichert) !== abdruck(ding)) return { ok: false, grund: 'konflikt', ding: gespeichert };

    return { ok: true, neu: false, ding: gespeichert };
  }

  /** Applies an already checked patch. Dotted paths, so `d` keeps everything the patch did not name. */
  public async aktualisiere(ding: Ding, aenderung: Record<string, unknown>): Promise<DingSchreiben> {
    const verweise = Object.keys(aenderung)
      .filter(path => path !== 't_ende')
      .map(path => ({ path: path, ding_id: aenderung[path] as string }));

    const problems = await this.loeseAuf(ding.zelt_id, verweise);
    if (problems.length > 0) return { ok: false, grund: 'verweis', problems: problems };

    await dingModel.updateOne({ ding_id: ding.ding_id }, { $set: aenderung });

    return { ok: true, neu: false, ding: await this.finde(ding.ding_id) };
  }

  /**
   * Every ding_id a Ding points at has to exist and has to be in the same tent.
   * `validateDing` is pure and cannot ask, so this is where a pour attributed to
   * a person nobody invented, or hung on another tent's plant, is caught.
   */
  private async pruefeVerweise(ding: Ding): Promise<DingProblem[]> {
    const verweise: Verweis[] = [];

    if (ding.akteur) verweise.push({ path: 'akteur', ding_id: ding.akteur });
    for (const [kante, ziele] of Object.entries(ding.rel ?? {})) {
      (ziele ?? []).forEach((ziel, i) => verweise.push({ path: `rel.${kante}[${i}]`, ding_id: ziel }));
    }
    for (const feld of ['dublette_von', 'geschlossen_von']) {
      const ziel = (ding.d ?? {})[feld];
      if (typeof ziel === 'string') verweise.push({ path: `d.${feld}`, ding_id: ziel });
    }

    return this.loeseAuf(ding.zelt_id, verweise);
  }

  /** One query for every reference, and one problem per reference that does not resolve. */
  private async loeseAuf(zelt_id: string, verweise: Verweis[]): Promise<DingProblem[]> {
    if (verweise.length === 0) return [];

    const gefunden: Pick<Ding, 'ding_id' | 'art'>[] = await dingModel
      .find({ zelt_id: zelt_id, ding_id: { $in: verweise.map(verweis => verweis.ding_id) } }, { _id: 0, ding_id: 1, art: 1 })
      .lean();
    const artJeId = new Map(gefunden.map(treffer => [treffer.ding_id, treffer.art]));

    return verweise.flatMap(verweis => {
      const art = artJeId.get(verweis.ding_id);
      // A path like `rel.an[0]` has no fixed art; only the three named ones do.
      const erwartet = VERWEIS_ART[verweis.path];

      if (!art) return [{ path: verweis.path, message: `${verweis.ding_id} is not a Ding of this Zelt` }];
      if (erwartet && art !== erwartet) return [{ path: verweis.path, message: `must point at a ${erwartet}, and ${verweis.ding_id} is a ${art}` }];

      return [];
    });
  }
}

export const dingService = new DingService();
