import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { BrowserPage } from './browser/browser.page';

/**
 * `/z/:zelt_id/:ding_id?`. Angular has no optional path segment, so the two
 * shapes are two entries - but they resolve to the same component, which is the
 * whole point of §3.3: there is no second browser and no device-shaped route.
 */
const routes: Routes = [
  { path: '', component: BrowserPage },
  { path: ':ding_id', component: BrowserPage },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ZeltRoutingModule {}
