/**
 * The clock a firmware update is judged by, and the one rule for starting it.
 *
 * `state.updateStartedAt` is the instant a device was last told which build to
 * install. Everything downstream is a comparison against it: the fleet counts a
 * device as updating while it is recent and as failed once it is older than
 * `UPGRADE_TIMEOUT_MS`, and the rollout writes the line that says an update did
 * not take from the same sum. So a device that is told and never stamped can
 * never be reported as having failed, however long it refuses the build.
 *
 * That is what this exists to prevent. The stamp used to be written in one
 * place - the sweep over the three release channels - while a build is pinned
 * in three: that sweep, `PATCH /devices/{id}`, and enrolment, which pins every
 * device to its class's stable build on the `manual` channel. Two of the three
 * therefore produced a device that owed an update, was told about it on a
 * doubling backoff for as long as it refused, and could not be counted or
 * closed. Each of them now says the same sentence in the same words.
 */
export const startedNow = (at: Date = new Date()): Record<string, Date | null> => ({
  'state.updateStartedAt': at,
  // A fresh instruction is a fresh attempt, so what was concluded about the
  // last one goes: an update that ended is no longer this device's news, and a
  // verdict already written in the diary must not stop the next one being.
  'state.updateEndedAt': null,
  'state.updateFailedAt': null,
});
