import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { SharesPageRoutingModule } from './shares-routing.module';

import { SharesPage } from './shares.page';
import { TranslateModule } from '@ngx-translate/core';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    SharesPageRoutingModule,
    TranslateModule.forChild()
  ],
  declarations: [SharesPage]
})
export class SharesPageModule {}
