import { createHash, randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { Schluessel, Zugangsschluessel } from '@interfaces/schluessel.interface';
import schluesselModel from '@models/schluessel.model';
import zugangsschluesselModel from '@models/zugangsschluessel.model';

/**
 * A token is 128 bits of randomness, so the only way to find it is to have been
 * given it: there is no dictionary to slow down and no reason for a work factor.
 * A plain digest keeps the lookup a single indexed query.
 */
const hashe = (token: string): string => createHash('sha256').update(token).digest('hex');

const mintToken = (): string => randomBytes(16).toString('hex');

/** Best effort: knowing when a key was last used is worth nothing if it can fail the request that used it. */
const stempel = (aktualisieren: () => Promise<unknown>): void => {
  void aktualisieren().catch(() => undefined);
};

/**
 * How many club keys one tent may have live at once.
 *
 * Not a capacity limit - the club that hands one to every member is exactly
 * what §13.5 is for - but a bound on how many working write credentials can
 * exist for a tent whose owner has stopped counting. A number nobody can name
 * is a number nobody revokes.
 */
export const SCHLUESSEL_MAX = 50;

/** A key as its owner sees it. The hash is not here, and there is no shape of this that carries it. */
export type SchluesselUebersicht = Pick<Schluessel, 'schluessel_id' | 'mensch_ding_id' | 'erstellt_at' | 'zuletzt_at' | 'widerrufen_at'>;

const OHNE_HASH = { _id: 0, schluessel_id: 1, mensch_ding_id: 1, erstellt_at: 1, zuletzt_at: 1, widerrufen_at: 1 };

class SchluesselService {
  /**
   * Mints the tent's read key, replacing whatever it had. The token is returned
   * once and never again - only its hash is kept, so a lost key is reissued
   * rather than looked up.
   */
  public async minteZugangsschluessel(zelt_id: string): Promise<{ token: string; erstellt_at: number }> {
    const token = mintToken();
    const erstellt_at = Date.now();

    await zugangsschluesselModel.updateOne(
      { zelt_id: zelt_id },
      { $set: { hash: hashe(token), erstellt_at: erstellt_at }, $unset: { zuletzt_at: '' } },
      { upsert: true },
    );

    return { token: token, erstellt_at: erstellt_at };
  }

  /** The read key of this tent, or null. Rotation invalidates the old token because only one hash is stored. */
  public async zugangsschluessel(zelt_id: string, token: string): Promise<Zugangsschluessel | null> {
    const schluessel: Zugangsschluessel = await zugangsschluesselModel.findOne({ zelt_id: zelt_id, hash: hashe(token) }, { _id: 0, __v: 0 }).lean();
    if (schluessel) {
      stempel(() => zugangsschluesselModel.updateOne({ zelt_id: zelt_id }, { $set: { zuletzt_at: Date.now() } }));
    }

    return schluessel;
  }

  /** Mints a write key for one person in one tent. Several keys may exist; each is revoked on its own. */
  public async minteSchluessel(zelt_id: string, mensch_ding_id: string): Promise<{ schluessel_id: string; token: string; url: string }> {
    const token = mintToken();
    const schluessel_id = uuidv4();

    await schluesselModel.create({
      schluessel_id: schluessel_id,
      zelt_id: zelt_id,
      mensch_ding_id: mensch_ding_id,
      hash: hashe(token),
      erstellt_at: Date.now(),
      widerrufen_at: null,
    });

    // Relative on purpose: the server knows its API origin, not the origin the
    // webapp is served from, and the owner shares this link by hand anyway.
    return { schluessel_id: schluessel_id, token: token, url: `/z/${zelt_id}?k=${token}` };
  }

  /**
   * Every club key of this tent, revoked ones included, and never a hash.
   *
   * Revoked ones stay in the list because "shown once, revocable" (§13.5) is
   * only half an answer without it: an owner asking who can write in their tent
   * is also asking who could, and a key that vanished on revocation makes the
   * question unanswerable a second time.
   */
  public async schluesselDesZelts(zelt_id: string): Promise<SchluesselUebersicht[]> {
    return schluesselModel.find({ zelt_id: zelt_id }, OHNE_HASH).sort({ erstellt_at: -1 }).lean();
  }

  /** How many keys of this tent still work. What `SCHLUESSEL_MAX` is counted against. */
  public async lebendeSchluessel(zelt_id: string): Promise<number> {
    return schluesselModel.countDocuments({ zelt_id: zelt_id, widerrufen_at: null });
  }

  /**
   * The key behind an id, hash included - the guard resolving which tent a
   * `schluessel_id` belongs to is the only caller, and it authorises against
   * that tent before it answers anything.
   */
  public async findeSchluessel(schluessel_id: string): Promise<Schluessel | null> {
    if (!schluessel_id) return null;

    return schluesselModel.findOne({ schluessel_id: schluessel_id }, { _id: 0, __v: 0 }).lean();
  }

  /**
   * Revokes one key. The row stays: `widerrufen_at` is what the list prints,
   * and a deleted row would take the answer to "who had a key" with it.
   *
   * Idempotent, and it keeps the first moment - a second revocation of an
   * already dead key is not a new event and must not re-date the old one.
   */
  public async widerrufeSchluessel(schluessel_id: string): Promise<number> {
    const widerrufen_at = Date.now();
    const ergebnis = await schluesselModel.updateOne(
      { schluessel_id: schluessel_id, widerrufen_at: null },
      { $set: { widerrufen_at: widerrufen_at } },
    );

    return ergebnis.modifiedCount > 0 ? widerrufen_at : (await this.findeSchluessel(schluessel_id))?.widerrufen_at ?? widerrufen_at;
  }

  /**
   * Turns the read key off. Deleted rather than flagged: there is one per tent
   * and its whole state is "a hash exists", so removing the hash is the off
   * switch. Rotation replaces the hash and can only ever hand out a new key -
   * it cannot leave the tent with none, which is what an owner who pasted the
   * key into the wrong window actually needs.
   */
  public async loescheZugangsschluessel(zelt_id: string): Promise<boolean> {
    return (await zugangsschluesselModel.deleteOne({ zelt_id: zelt_id })).deletedCount > 0;
  }

  /** The key behind a token, or null when there is none or it was revoked. */
  public async schluessel(token: string): Promise<Schluessel | null> {
    const schluessel: Schluessel = await schluesselModel.findOne({ hash: hashe(token), widerrufen_at: null }, { _id: 0, __v: 0 }).lean();
    if (schluessel) {
      stempel(() => schluesselModel.updateOne({ schluessel_id: schluessel.schluessel_id }, { $set: { zuletzt_at: Date.now() } }));
    }

    return schluessel;
  }
}

export const schluesselService = new SchluesselService();
