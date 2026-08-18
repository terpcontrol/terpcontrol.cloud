import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Routes } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { ConnectionErrorPage } from './connection-error.page';

const routes: Routes = [
  {
    path: '',
    component: ConnectionErrorPage
  }
];

@NgModule({
  imports: [
    CommonModule,
    IonicModule,
    RouterModule.forChild(routes),
    TranslateModule.forChild()
  ],
  declarations: [ConnectionErrorPage]
})
export class ConnectionErrorPageModule {}
