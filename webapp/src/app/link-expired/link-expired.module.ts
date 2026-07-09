import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Routes } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { LinkExpiredPage } from './link-expired.page';

const routes: Routes = [
  {
    path: '',
    component: LinkExpiredPage
  }
];

@NgModule({
  imports: [
    CommonModule,
    IonicModule,
    RouterModule.forChild(routes),
    TranslateModule.forChild()
  ],
  declarations: [LinkExpiredPage]
})
export class LinkExpiredPageModule {}
