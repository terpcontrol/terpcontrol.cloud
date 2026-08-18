import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { TranslateModule } from '@ngx-translate/core';
import {AlarmsComponent} from "./alarms.component";
import {AlarmAddModalComponent} from "./alarm-add-modal.component";

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    TranslateModule.forChild(),
  ],
  exports: [
    AlarmsComponent,
    AlarmAddModalComponent
  ],
  declarations: [AlarmsComponent, AlarmAddModalComponent]
})
export class AlarmsModule {}
