import { MigrationStep } from '../migration';
import { pictureBytesIntoTheBucket } from './001-picture-bytes-into-the-bucket';
import { users } from './002-users';
import { fleet } from './003-fleet';
import { spaces } from './004-spaces';
import { devices } from './005-devices';
import { plans } from './006-plans';
import { alarmRules } from './007-alarm-rules';
import { cameras } from './008-cameras';
import { planTemplates } from './009-plan-templates';
import { grows } from './010-grows';
import { entries } from './011-entries';
import { media } from './012-media';
import { retiredCollections } from './013-retired-collections';
import { oneLinePerTask } from './014-one-line-per-task';
import { warningsRouting } from './015-warnings-routing';
import { measurementBand } from './016-measurement-band';
import { entryCredentials } from './017-entry-credentials';
import { targetRecord } from './018-target-record';
import { workModes } from './019-work-modes';
import { retiredDryers } from './020-retired-dryers';

/**
 * In order, and the order matters in six places:
 *
 * - the picture bytes move first, because that job looks for its documents in
 *   `images` and every step after it has moved that collection aside;
 * - the spaces are made before the devices, the plans, the alarms and the
 *   cameras, because all four point at one;
 * - the grows are reconstructed before the entries and the pictures that name
 *   the grow they happened in;
 * - the credentials are struck out of the diary after it has been built, so
 *   that a database being migrated for the first time and one migrated a
 *   release ago are left in the same state by the same step;
 * - the target record is opened from the devices' configuration, which is
 *   only in the new shape once the devices have been migrated, and the work
 *   modes are decided over the devices, plans and templates in that shape too;
 * - the dryers are deleted once everything that names one has been migrated,
 *   so that nothing a later step writes points at a device that is gone.
 *
 * Everything else is independent, and every step is a no-op on a database that
 * does not have the collection it reads - which is what a fresh install is.
 */
export const MIGRATION_STEPS: MigrationStep[] = [
  pictureBytesIntoTheBucket,
  users,
  fleet,
  spaces,
  devices,
  plans,
  alarmRules,
  cameras,
  planTemplates,
  grows,
  entries,
  media,
  retiredCollections,
  oneLinePerTask,
  warningsRouting,
  measurementBand,
  entryCredentials,
  targetRecord,
  workModes,
  retiredDryers,
];
