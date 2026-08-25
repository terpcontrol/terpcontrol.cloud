import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { PipesModule } from 'src/app/pipes/pipes.module';
import { BrowserPage } from './browser/browser.page';
import { FaktComponent } from './koerper/fakt.component';
import { KoerperHostDirective } from './koerper/koerper-host.directive';
import { KOERPER_KOMPONENTEN } from './koerper/koerper.registry';
import { PaarComponent } from './paar/paar.component';
import { SatzComponent } from './satz/satz.component';
import { TafelComponent } from './tafel/tafel.component';
import { WerteComponent } from './werte/werte.component';
import { ZeileComponent } from './zeile/zeile.component';
import { HoeheHaltenDirective } from './zeitgriff/hoehe-halten.directive';
import { ZeitgriffComponent } from './zeitgriff/zeitgriff.component';
import { ZeitlageComponent } from './zeitgriff/zeitlage.component';
import { ZeltRoutingModule } from './zelt-routing.module';

/**
 * The browser: one Zeile, one Tafel, and one declared body per art. The bodies
 * are separate components from the first commit on purpose - sixteen arts in
 * one template is how this becomes the next `charts.page.ts`.
 */
@NgModule({
  declarations: [
    BrowserPage,
    TafelComponent,
    ZeileComponent,
    WerteComponent,
    PaarComponent,
    SatzComponent,
    FaktComponent,
    KoerperHostDirective,
    ZeitgriffComponent,
    ZeitlageComponent,
    HoeheHaltenDirective,
    ...KOERPER_KOMPONENTEN,
  ],
  imports: [CommonModule, IonicModule, RouterModule, PipesModule, TranslateModule.forChild(), ZeltRoutingModule],
  // The Zeile and the Tafel are the two shapes of the product; anything that
  // shows a Ding uses them rather than drawing a third.
  exports: [TafelComponent, ZeileComponent, WerteComponent, PaarComponent, SatzComponent, KoerperHostDirective, ZeitgriffComponent, ZeitlageComponent],
})
export class ZeltModule {}
