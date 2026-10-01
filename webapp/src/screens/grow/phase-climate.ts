/** What a phase does to the climate where its plants stand: nothing, or one climate of the one list. */
export interface PhaseClimate {
  /** Whether the controllers are put on the stage's climate as the phase is written. */
  climate: boolean;
  /** Which refinement of the stage, where one was chosen; null is the stage's own climate. */
  preset: string | null;
}

export const KEEP_CLIMATE: PhaseClimate = { climate: false, preset: null };

/** What the request says about it: nothing at all where the climate is kept, so an older server reads it the same way. */
export const climateRequest = (pick: PhaseClimate): { preset: string | null; climate?: true } =>
  pick.climate ? { preset: pick.preset, climate: true } : { preset: null };
