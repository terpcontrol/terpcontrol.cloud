import { connect, disconnect, Model } from 'mongoose';
import { dbConnection } from '@databases';
import imageModel from '@models/images.model';
import { withMigrationLock } from '@utils/migration-lock';

/**
 * Makes the indexes in the database match the ones the models declare.
 *
 *     npm run migrate:indexes             # report, then apply
 *     npm run migrate:indexes -- --dry-run
 *
 * Run it once, from one machine, before the deploy that needs it. It is never
 * called from the boot and must not be: `createIndexes()` creates and never
 * alters, so narrowing `Image`'s unique index means dropping the old one first,
 * and a drop in a boot path races the second pm2 instance and swallows its own
 * failure. That is decision D3, and §4.4 is the change it exists for.
 *
 * Re-running is safe. The plan is computed first and an empty plan touches
 * nothing, so the second run of an applied migration is a report and an exit.
 * A plan that is not empty needs the lock, and the lock is taken once per name:
 * if indexes drift apart again after this has run, `db.migrations.deleteOne({
 * name: 'bild-indexe' })` re-arms it.
 *
 * The plan drops as well as builds, and it drops everything the models do not
 * declare - an index somebody added by hand included. That is why it is printed
 * before it is applied, and why `--dry-run` exists.
 *
 * Rolling back is re-creating the old index by hand. Nothing depends on its
 * uniqueness except the timelapse writer, which keeps it (§20.1 item 7).
 */
const SPERRE = 'bild-indexe';

/** Every model whose declared indexes this migration owns. */
const MODELLE: Model<any>[] = [imageModel];

export interface IndexPlan {
  modell: string;
  /** Index names to drop, by the name the database knows them under. */
  entfernen: string[];
  /** Key patterns to build, with the options that make them what they are. */
  anlegen: Array<[Record<string, unknown>, Record<string, unknown>]>;
}

export const istLeer = (plan: IndexPlan[]): boolean => plan.every(eintrag => eintrag.entfernen.length === 0 && eintrag.anlegen.length === 0);

/** What `migriereIndexe` would do, without doing any of it. */
export async function indexPlan(modelle: Model<any>[] = MODELLE): Promise<IndexPlan[]> {
  return Promise.all(
    modelle.map(async modell => {
      const { toDrop, toCreate } = await modell.diffIndexes({ indexOptionsToCreate: true });
      return { modell: modell.modelName, entfernen: toDrop, anlegen: toCreate as IndexPlan['anlegen'] };
    }),
  );
}

// Mongoose carries its own bookkeeping in the index options; an operator
// reading the plan is only owed what makes the index what it is.
const lesbar = (optionen: Record<string, unknown> = {}): string =>
  JSON.stringify(Object.fromEntries(Object.entries(optionen).filter(([schluessel]) => !schluessel.startsWith('_'))));

/** The plan in the words an operator has to read before agreeing to it. */
export function berichte(plan: IndexPlan[], schreibe: (zeile: string) => void = console.log): void {
  if (istLeer(plan)) {
    schreibe('Indexes already match what the models declare - nothing to do.');
    return;
  }

  for (const eintrag of plan) {
    for (const name of eintrag.entfernen) {
      schreibe(`${eintrag.modell}: drop  ${name}`);
    }
    for (const [schluessel, optionen] of eintrag.anlegen) {
      schreibe(`${eintrag.modell}: build ${JSON.stringify(schluessel)} ${lesbar(optionen)}`);
    }
  }
}

export interface IndexErgebnis {
  plan: IndexPlan[];
  angewendet: boolean;
}

/**
 * Reports the plan, then applies it under the migration lock. `angewendet` is
 * false when there was nothing to apply and when another run held the lock -
 * the empty plan tells the caller which of the two it was.
 */
export async function migriereIndexe(
  modelle: Model<any>[] = MODELLE,
  schreibe: (zeile: string) => void = console.log,
  nurBericht = false,
): Promise<IndexErgebnis> {
  const plan = await indexPlan(modelle);
  berichte(plan, schreibe);

  if (istLeer(plan) || nurBericht) {
    return { plan: plan, angewendet: false };
  }

  const angewendet = await withMigrationLock(SPERRE, async () => {
    for (const modell of modelle) {
      await modell.syncIndexes();
    }
  });

  schreibe(angewendet ? 'Indexes applied.' : `Nothing applied: another run holds ${SPERRE}, or it has already run once.`);
  return { plan: plan, angewendet: angewendet };
}

async function main(): Promise<void> {
  const nurBericht = process.argv.includes('--dry-run');
  await connect(dbConnection.url, dbConnection.options);

  try {
    const { plan, angewendet } = await migriereIndexe(MODELLE, console.log, nurBericht);
    // A plan that was neither empty nor applied is the case an operator must
    // not read past: the deploy it precedes would run on the old indexes.
    process.exitCode = istLeer(plan) || angewendet || nurBericht ? 0 : 1;
  } finally {
    await disconnect();
  }
}

if (require.main === module) {
  main().catch(fehler => {
    console.error(`migrate:indexes failed: ${fehler}`);
    process.exit(1);
  });
}
