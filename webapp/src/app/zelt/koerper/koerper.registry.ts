import { Type } from '@angular/core';
import type { DingArt } from '@fg2/shared-types';
import { BildKoerperComponent } from './bild.koerper';
import { DoseKoerperComponent } from './dose.koerper';
import { EreignisKoerperComponent } from './ereignis.koerper';
import { FilmKoerperComponent } from './film.koerper';
import { GabeKoerperComponent } from './gabe.koerper';
import { GeraetKoerperComponent } from './geraet.koerper';
import { KameraKoerperComponent } from './kamera.koerper';
import { KoerperBasis } from './koerper-basis';
import { LaufKoerperComponent } from './lauf.koerper';
import { MenschKoerperComponent } from './mensch.koerper';
import { NotizKoerperComponent } from './notiz.koerper';
import { PflanzeKoerperComponent } from './pflanze.koerper';
import { PhaseKoerperComponent } from './phase.koerper';
import { SchemaKoerperComponent } from './schema.koerper';
import { ZeltKoerperComponent } from './zelt.koerper';
import { ZielKoerperComponent } from './ziel.koerper';
import { ZustandKoerperComponent } from './zustand.koerper';

/**
 * Art to body, and the reason this file exists rather than a `switch` inside
 * the Tafel's template: sixteen arts in one template is how the browser becomes
 * the next `charts.page.ts`. Every art is declared here, so adding one is a
 * component and a line, and no existing body is touched.
 *
 * The map is total over `DingArt`. A missing entry is a compile error, not a
 * blank screen.
 */
export const KOERPER: Readonly<Record<DingArt, Type<KoerperBasis>>> = Object.freeze({
  zelt: ZeltKoerperComponent,
  geraet: GeraetKoerperComponent,
  pflanze: PflanzeKoerperComponent,
  dose: DoseKoerperComponent,
  kamera: KameraKoerperComponent,
  bild: BildKoerperComponent,
  film: FilmKoerperComponent,
  gabe: GabeKoerperComponent,
  notiz: NotizKoerperComponent,
  zustand: ZustandKoerperComponent,
  phase: PhaseKoerperComponent,
  ziel: ZielKoerperComponent,
  mensch: MenschKoerperComponent,
  ereignis: EreignisKoerperComponent,
  schema: SchemaKoerperComponent,
  lauf: LaufKoerperComponent,
});

/**
 * Every body, for the module's declarations. Written out rather than derived
 * from the map above because the Angular compiler resolves `declarations`
 * statically and cannot follow `Object.values`.
 */
export const KOERPER_KOMPONENTEN = [
  ZeltKoerperComponent,
  GeraetKoerperComponent,
  PflanzeKoerperComponent,
  DoseKoerperComponent,
  KameraKoerperComponent,
  BildKoerperComponent,
  FilmKoerperComponent,
  GabeKoerperComponent,
  NotizKoerperComponent,
  ZustandKoerperComponent,
  PhaseKoerperComponent,
  ZielKoerperComponent,
  MenschKoerperComponent,
  EreignisKoerperComponent,
  SchemaKoerperComponent,
  LaufKoerperComponent,
];

export const koerperFuer = (art: DingArt): Type<KoerperBasis> | null => KOERPER[art] ?? null;
