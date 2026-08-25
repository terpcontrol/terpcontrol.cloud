import { NextFunction, Response } from 'express';
import { Ding, DingArt, GESPEICHERTE_ARTEN, SCHLUESSEL_ARTEN } from '@fg2/shared-types';
import { RequestWithUser } from '@interfaces/auth.interface';
import { Schluessel } from '@interfaces/schluessel.interface';
import zeltModel from '@models/zelt.model';
import { darfLesenMiddelware, darfSchreibenMiddelware } from '@middlewares/auth.middleware';
import { dingService, DingSchreiben } from '@services/ding.service';
import { PROJIZIERTE_ARTEN } from '@services/ding-adapter';
import { dekodiereCursor, DingCursor } from '@utils/ding-cursor';
import { validateDingPatch } from '@utils/ding-patch-validierung';
import { DingPruefung, T_SKEW_MS, validateDing } from '@utils/ding-validierung';

const ALLE_ARTEN: string[] = [...GESPEICHERTE_ARTEN, ...PROJIZIERTE_ARTEN];

const LIMIT_STANDARD = 100;
const LIMIT_MAX = 500;
/** The offline queue drains in chunks; the body parser's 100 kB is the real ceiling and this stays under it. */
const STAPEL_MAX = 200;

/** What a page was asked for, or the reason it cannot be answered. */
type Anfrage = { ok: true; arten: DingArt[]; von: number; bis: number; cursor: DingCursor | null; limit: number } | { ok: false; problem: string };

const zahl = (roh: unknown, ersatz: number): number | null => {
  if (roh === undefined || roh === '') return ersatz;
  const wert = Number(roh);
  return Number.isFinite(wert) ? wert : null;
};

const leseAnfrage = (query: Record<string, unknown>): Anfrage => {
  const arten = typeof query.art === 'string' && query.art !== '' ? query.art.split(',').map(art => art.trim()) : ALLE_ARTEN;
  const unbekannt = arten.filter(art => !ALLE_ARTEN.includes(art));
  if (unbekannt.length > 0) return { ok: false, problem: `art: unknown ${unbekannt.join(', ')} - the arts are ${ALLE_ARTEN.join(', ')}` };

  // No upper bound asked for means everything that has happened - and on a phone
  // an hour ahead of the server, that includes an entry stamped an hour ahead.
  const von = zahl(query.von, 0);
  const bis = zahl(query.bis, Date.now() + T_SKEW_MS);
  if (von === null || bis === null) return { ok: false, problem: 'von and bis must be epoch-ms numbers' };

  const limit = zahl(query.limit, LIMIT_STANDARD);
  if (limit === null || !Number.isInteger(limit) || limit < 1 || limit > LIMIT_MAX) {
    return { ok: false, problem: `limit must be a whole number between 1 and ${LIMIT_MAX}` };
  }

  const roherCursor = typeof query.cursor === 'string' ? query.cursor : '';
  const cursor = roherCursor === '' ? null : dekodiereCursor(roherCursor);
  if (roherCursor !== '' && !cursor) return { ok: false, problem: 'cursor is not one this server handed out' };

  return { ok: true, arten: arten as DingArt[], von: von, bis: bis, cursor: cursor, limit: limit };
};

const zeltIdAus = (koerper: unknown): string => {
  const zelt_id = (koerper as { zelt_id?: unknown })?.zelt_id;
  return typeof zelt_id === 'string' ? zelt_id : '';
};

/**
 * The one place a submitted Ding is turned into a storable one.
 *
 * The owner picks the person on the sheet, so `akteur` is theirs to send. A club
 * key is the other way round: the key *is* the person (§13.5), so `akteur` comes
 * from it and a body that carries one is refused rather than quietly corrected -
 * a client that believes it signed an entry as somebody else has to be told it
 * did not. The key's reach is then checked against `SCHLUESSEL_ARTEN`: it logs
 * what happened in the tent, it does not restructure it.
 */
const pruefeEingang = (schluessel: Schluessel | undefined, eingabe: unknown): DingPruefung => {
  if (!schluessel) return validateDing(eingabe);

  if (typeof eingabe === 'object' && eingabe !== null && (eingabe as Ding).akteur !== undefined) {
    return { ok: false, problems: [{ path: 'akteur', message: 'is taken from the Schlüssel and must not be sent - the key is the person' }] };
  }

  const pruefung = validateDing({ ...(eingabe as object), akteur: schluessel.mensch_ding_id });
  if (pruefung.ok === false) return pruefung;

  if (!SCHLUESSEL_ARTEN.includes(pruefung.ding.art)) {
    return { ok: false, problems: [{ path: 'art', message: `a Schlüssel may write only ${SCHLUESSEL_ARTEN.join(', ')}` }] };
  }

  return pruefung;
};

/** The status a write answers with: created and unchanged both succeeded, a taken id did not. */
const status = (ergebnis: DingSchreiben): number => (ergebnis.ok === true ? 200 : ergebnis.grund === 'konflikt' ? 409 : 400);

const koerper = (ergebnis: DingSchreiben): Record<string, unknown> =>
  ergebnis.ok === true
    ? { ding: ergebnis.ding }
    : ergebnis.grund === 'konflikt'
    ? {
        message: 'ding_id is already taken by a different Ding - a value is corrected by writing a new Ding, never by rewriting one',
        ding: ergebnis.ding,
      }
    : { problems: ergebnis.problems };

class DingController {
  /**
   * The one read every screen is built from. Stored and projected Dinge come
   * back merged, so a caller cannot tell which of them mongo held and which of
   * them a device, an image or a socket table was read for.
   */
  public getDinge = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      if (!(await darfLesenMiddelware(req, res, typeof req.query.zelt_id === 'string' ? req.query.zelt_id : ''))) return;

      const anfrage = leseAnfrage(req.query as Record<string, unknown>);
      if (anfrage.ok === false) {
        res.status(400).json({ message: anfrage.problem });
        return;
      }

      const zelt = await zeltModel.findOne({ zelt_id: String(req.query.zelt_id) }, { _id: 0, __v: 0 }).lean();
      if (!zelt) {
        res.status(404).json({ message: 'Zelt not found' });
        return;
      }

      res.status(200).json(
        await dingService.seite({
          zelt: zelt,
          arten: anfrage.arten,
          von: anfrage.von,
          bis: anfrage.bis,
          cursor: anfrage.cursor,
          limit: anfrage.limit,
        }),
      );
    } catch (error) {
      next(error);
    }
  };

  /**
   * 200 rather than 201: the write is an insert on a client-minted id, and a
   * retry that finds its own earlier attempt already stored created nothing the
   * first attempt had not. A *different* Ding under a taken id is a 409.
   */
  public postDing = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      if (!(await darfSchreibenMiddelware(req, res, zeltIdAus(req.body)))) return;

      const pruefung = pruefeEingang(req.schluessel, req.body);
      if (pruefung.ok === false) {
        res.status(400).json({ problems: pruefung.problems });
        return;
      }

      const ergebnis = await dingService.speichere(pruefung.ding);
      res.status(status(ergebnis)).json(koerper(ergebnis));
    } catch (error) {
      next(error);
    }
  };

  public patchDing = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      const ding = await this.zumSchreiben(req, res, req.params.ding_id);
      if (!ding) return;

      const pruefung = validateDingPatch(ding, req.body);
      if (pruefung.ok === false) {
        res.status(400).json({ problems: pruefung.problems });
        return;
      }

      const ergebnis = await dingService.aktualisiere(ding, pruefung.aenderung);
      res.status(status(ergebnis)).json(koerper(ergebnis));
    } catch (error) {
      next(error);
    }
  };

  /**
   * The offline queue's drain. Every item is inserted on its own id, and an item
   * that will not validate is reported in its own result rather than taking the
   * batch down with it: a queue that empties only when all of it is perfect never
   * empties.
   *
   * Authorisation is not per item. A batch reaching a tent the caller may not
   * write is a bug or an attack, never a partial success, so it is refused whole.
   */
  public postStapel = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      if (!(await this.darfStapelSchreiben(req, res))) return;

      const dinge: unknown[] = req.body.dinge;
      if (dinge.length > STAPEL_MAX) {
        res.status(400).json({ message: `dinge must hold at most ${STAPEL_MAX} entries` });
        return;
      }

      const ergebnisse = [];
      for (const eingabe of dinge) {
        const eingereicht = (eingabe as Ding)?.ding_id;
        const pruefung = pruefeEingang(req.schluessel, eingabe);
        if (pruefung.ok === false) {
          ergebnisse.push({ ding_id: typeof eingereicht === 'string' ? eingereicht : null, ok: false, status: 400, problems: pruefung.problems });
          continue;
        }

        const ergebnis = await dingService.speichere(pruefung.ding);
        ergebnisse.push({ ding_id: pruefung.ding.ding_id, ok: ergebnis.ok === true, status: status(ergebnis), ...koerper(ergebnis) });
      }

      res.status(200).json({ ergebnisse: ergebnisse });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Resolving the Ding and authorising it are one step, so a handler's first
   * line can still be its guard: a `ding_id` names no tent by itself, and the
   * tent is what may be written to.
   *
   * An unknown id is therefore refused rather than reported missing. There is no
   * tent behind it to authorise against, and answering 404 to whoever asks would
   * say more than a refusal does.
   */
  private zumSchreiben = async (req: RequestWithUser, res: Response, ding_id: string): Promise<Ding | null> => {
    const ding = await dingService.finde(ding_id);
    if (!(await darfSchreibenMiddelware(req, res, ding?.zelt_id ?? ''))) return null;

    if (req.schluessel && !SCHLUESSEL_ARTEN.includes(ding.art)) {
      res.status(403).send(`a Schlüssel may change only ${SCHLUESSEL_ARTEN.join(', ')}`);
      return null;
    }

    return ding;
  };

  /** Every tent the batch touches has to be writable, and a body that names none is refused before anything is read. */
  private darfStapelSchreiben = async (req: RequestWithUser, res: Response): Promise<boolean> => {
    const dinge: unknown[] = Array.isArray(req.body?.dinge) ? req.body.dinge : [];
    // An item that names no tent is a validation failure and is reported as one;
    // an item naming a *different* tent is not, and refuses the batch.
    const zelte = [...new Set(dinge.map(zeltIdAus))].filter(zelt_id => zelt_id !== '');

    for (const zelt_id of zelte.length > 0 ? zelte : ['']) {
      if (!(await darfSchreibenMiddelware(req, res, zelt_id))) return false;
    }

    return true;
  };
}

export default DingController;
