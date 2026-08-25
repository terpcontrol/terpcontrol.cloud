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
