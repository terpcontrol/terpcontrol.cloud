import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { SharesPage } from './shares.page';

const routes: Routes = [
  {
    path: '',
    component: SharesPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class SharesPageRoutingModule {}
