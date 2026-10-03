import type { DeviceConfiguration, DeviceControl, GrowthStage, OperatingMode } from '@fg2/shared-types/v1';
import { dryingReturnOf } from './drying-return';

/**
 * The work mode: the one key of a fridge's or a controller's document that says
 * what the hardware does as a whole, and the one the server decides rather than
 * passes on.
 *
 * The firmware knows `off`, `small`, `full`, `temp`, `breed` and `dry`, and
 * treats any other word as off. A person decides three things about it
 * separately - whether the device regulates at all, which operating mode it
 * runs, and (a fridge's standard mode only) whether the back-wall fan rests with
 * the compressor - and a drying phase decides a fourth. One key cannot remember
 * the rest while it says `off` or `dry`, and the firmware drops a key it does
 * not know the next time it uploads its document, so what the device goes back
 * to is kept on the device row as `baseWorkmode`.
 *
 * Only a document that already carries a work mode is touched: a light, a plug
 * and a fan have none, and a document that never stated one is not given one
 * the device did not ask for.
 */

export type BaseWorkmode = 'small' | 'full' | 'temp' | 'breed';

const BASE_MODES: readonly string[] = ['small', 'full', 'temp', 'breed'];
const RUNNING_MODES: readonly string[] = [...BASE_MODES, 'dry'];

/** The hardware whose firmware reads a work mode. */
const WITH_WORK_MODES: readonly string[] = ['fridge', 'controller'];

/** What a write is, which is what decides the work mode it leaves the device in. */
export type WriteIntent =
  /**
   * The targets saved by hand: a device that was switched off is switched on
   * again. `drying` says whether they are a drying room's - true dries, false
   * ends a drying spell - and left out a drying device stays drying.
   * `germination` is the same for germination in the dark, which false ends
   * for the standard mode.
   */
  | { kind: 'targets'; drying?: boolean; germination?: boolean }
  /**
   * A climate preset, a phase, or a plan step, with the stage it is for. Drying
   * dries and germination germinates in the dark; any other stage - or a plan
   * step that names none - switches the device on, ends a drying spell and
   * brings it out of germination into its standard mode, and otherwise leaves
   * it on its own mode. `requested` is what a plan step carries itself.
   * `night` says whether the write brings a night temperature of its own,
   * which coming out of germination otherwise puts back (see
   * `DeviceConfigurationService.store`).
   */
  | { kind: 'climate'; stage: GrowthStage | null; requested?: unknown; night?: boolean }
  /** The settings a person changed one at a time, of which these four are about the work mode. */
  | { kind: 'fields'; control?: boolean; drying?: boolean; mode?: OperatingMode; energySaving?: boolean }
  /** The times of day moved onto the owner's clock, which decides nothing else. */
  | { kind: 'clock' };

export const hasWorkModes = (type: string): boolean => WITH_WORK_MODES.includes(type);

const isBase = (value: unknown): value is BaseWorkmode => typeof value === 'string' && BASE_MODES.includes(value);

const isRunning = (value: unknown): boolean => typeof value === 'string' && RUNNING_MODES.includes(value);

/** What the device goes back to: what it runs where that is its own mode, else what it was last running, else the standard. */
const standingOf = (current: unknown, base: string | null | undefined): BaseWorkmode => (isBase(current) ? current : isBase(base) ? base : 'small');

const modeOf = (workmode: BaseWorkmode): OperatingMode => (workmode === 'temp' ? 'greenhouse' : workmode === 'breed' ? 'germination' : 'standard');

/**
 * The work mode an operating mode is run in. A controller has no back-wall fan
 * and its firmware reads `full` as `small`, so energy saving is a fridge's.
 */
const workmodeOf = (type: string, mode: OperatingMode, energySaving: boolean): BaseWorkmode =>
  mode === 'greenhouse' ? 'temp' : mode === 'germination' ? 'breed' : energySaving && type === 'fridge' ? 'full' : 'small';

/** How the device stands, in the words the screens read. Null for hardware with no work mode, or no document yet. */
export const controlOf = (
  type: string,
  configuration: DeviceConfiguration | null,
  base: string | null | undefined,
  /** What a drying spell put aside (`drying-return.ts`), which is told while it lasts. */
  beforeDrying: Record<string, number> | null = null,
  /** The night's temperature germination put aside, told while the device germinates. */
  beforeGermination: Record<string, number> | null = null,
): DeviceControl | null => {
  const current = configuration?.workmode;
  if (!hasWorkModes(type) || typeof current !== 'string') return null;

  const standing = standingOf(current, base);
  return {
    running: isRunning(current),
    drying: current === 'dry',
    mode: modeOf(standing),
    energySaving: type === 'fridge' && standing === 'full',
    ...(current === 'dry' && beforeDrying && Object.keys(beforeDrying).length > 0 ? { afterDrying: dryingReturnOf(beforeDrying) } : {}),
    ...(standing === 'breed' && beforeGermination && Object.keys(beforeGermination).length > 0
      ? { afterGermination: dryingReturnOf(beforeGermination) }
      : {}),
  };
};

/** The standard mode a device comes back to from another: the one it last ran, energy saving included, which is a fridge's alone. */
const standardFor = (type: string, standard: string | null | undefined): BaseWorkmode =>
  standard === 'full' && type === 'fridge' ? 'full' : 'small';

/**
 * The work mode a write leaves the device in, and the one it goes back to
 * afterwards. `current` is what the stored document says now; `wanted` is the
 * document the write would store, whose own work mode is what a client sent and
 * is not believed - a page drawn a minute ago sends the mode it was drawn with.
 *
 * Germination is the one mode a stage puts a device into besides drying, and
 * it is dark: no write that is not about germination leaves a device in it.
 * Any other stage, a plan step with none, and targets saved with
 * `germination: false` bring it back to the standard mode, whose energy saving
 * stands where it was left.
 */
export const decideWorkmode = (
  type: string,
  current: unknown,
  base: string | null | undefined,
  intent: WriteIntent,
  /** The standard mode last run, which a return to the standard comes back to (see `standardOf`). */
  standard: string | null | undefined = null,
): { workmode: string; base: BaseWorkmode } | null => {
  if (!hasWorkModes(type) || typeof current !== 'string') return null;

  const standing = standingOf(current, base);
  switch (intent.kind) {
    case 'clock':
      return { workmode: current, base: standing };
    case 'targets': {
      const next =
        intent.germination === true ? 'breed' : intent.germination === false && standing === 'breed' ? standardFor(type, standard) : standing;
      if (intent.drying !== undefined) return { workmode: intent.drying ? 'dry' : next, base: next };
      if (intent.germination === true) return { workmode: 'breed', base: next };
      return { workmode: isRunning(current) && current !== 'breed' ? current : next, base: next };
    }
    case 'climate': {
      // A plan written before the switch carried the old app's whole document,
      // `small` or `full` included, and would put the switch back every hour; a
      // step that turns the device off, dries or runs another mode still does.
      const asked = intent.requested;
      if (typeof asked === 'string' && asked !== 'small' && asked !== 'full') return { workmode: asked, base: isBase(asked) ? asked : standing };
      if (intent.stage === 'germination') return { workmode: 'breed', base: 'breed' };
      // Only germination is dark, so any other write of a climate - a step that
      // names no stage among them - brings the device out of it, as it ends a
      // drying spell or an off. A step without a stage is still a climate with
      // light: the old app's recipes ran their germination step on `breed` and
      // every step after it on the standard mode, which the steps no longer say
      // since the small and the full went out of them.
      const next = standing === 'breed' ? standardFor(type, standard) : standing;
      return { workmode: intent.stage === 'drying' ? 'dry' : next, base: next };
    }
    case 'fields': {
      const now = controlOf(type, { workmode: current }, base)!;
      // Back to the standard from another mode, the energy-saving switch stands where it was left.
      const saving = intent.energySaving ?? (now.mode === 'standard' ? now.energySaving : standard === 'full');
      const next = workmodeOf(type, intent.mode ?? now.mode, saving);
      // Starting to dry starts the device; ending it goes back to the mode it ran.
      const running = intent.control ?? (intent.drying === true || now.running);
      const drying = intent.drying ?? now.drying;
      return { workmode: !running ? 'off' : drying ? 'dry' : next, base: next };
    }
  }
};

/** What a document the device uploaded says it goes back to, where it says so: the mode it runs, unless that is off or drying. */
export const baseFromUpload = (type: string, configuration: DeviceConfiguration): BaseWorkmode | null =>
  hasWorkModes(type) && isBase(configuration.workmode) ? configuration.workmode : null;

/** The standard mode a base is, where it is one: what is kept to come back to when another mode ends. */
export const standardOf = (base: string | null | undefined): 'small' | 'full' | null => (base === 'small' || base === 'full' ? base : null);
