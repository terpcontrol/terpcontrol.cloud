import { LOCALE_ID, NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';

import { IonicModule, IonicRouteStrategy } from '@ionic/angular';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { AuthModule } from './auth/auth.module';
import { RoundPipe } from './pipes/round.pipe';

import { MissingTranslationHandler, TranslateModule, TranslateLoader } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { HttpClient } from '@angular/common/http';
import { PipesModule } from './pipes/pipes.module';
import { resolveAppLocale } from './util/locale';
import { TerpMissingTranslationHandler } from './util/missing-translation';

@NgModule({
  declarations: [
    AppComponent,
  ],
  imports: [
    BrowserModule,
    IonicModule.forRoot(),
    AppRoutingModule,
    AuthModule,
    PipesModule,
    TranslateModule.forRoot({
      loader: {
        provide: TranslateLoader,
        useFactory: (createTranslateLoader),
        deps: [HttpClient]
      },
      // A key that is not in the bundle must never reach the screen as a dotted
      // path: two lookups in the Zelt browser build their key by concatenation.
      missingTranslationHandler: {
        provide: MissingTranslationHandler,
        useClass: TerpMissingTranslationHandler
      },
      useDefaultLang: true
    }),
  ],
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    // Dates and numbers follow the same browser language as the translations,
    // instead of Angular's en-US default.
    { provide: LOCALE_ID, useFactory: resolveAppLocale },
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}

export function createTranslateLoader(http: HttpClient) {
  return new TranslateHttpLoader(http, "./assets/i18n/", ".json");
}
