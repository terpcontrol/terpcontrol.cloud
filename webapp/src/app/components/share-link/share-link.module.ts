import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { ShareLinkModalComponent } from './share-link-modal.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    TranslateModule,
  ],
  declarations: [ShareLinkModalComponent],
  exports: [ShareLinkModalComponent],
})
export class ShareLinkModule {}
