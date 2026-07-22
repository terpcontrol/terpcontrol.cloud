import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ValuedisplayComponent } from './valuedisplay/valuedisplay.component';
import { StagePresetPickerComponent } from './stage-preset-picker/stage-preset-picker.component';
import { SetupWizardComponent } from './setup-wizard/setup-wizard.component';
import { GrowAssistantCardComponent } from './grow-assistant/grow-assistant-card.component';
import { AuxDevicesComponent } from './aux-devices/aux-devices.component';
import { ValueEditRowComponent } from './value-edit-row/value-edit-row.component';
import { DeleteDeviceRowComponent } from './delete-device-row/delete-device-row.component';
import { RangeGuardDirective } from './range-guard.directive';
import { IonicModule } from '@ionic/angular';
import { PipesModule } from 'src/app/pipes/pipes.module';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

@NgModule({
  declarations: [
    ValuedisplayComponent,
    StagePresetPickerComponent,
    SetupWizardComponent,
    GrowAssistantCardComponent,
    AuxDevicesComponent,
    ValueEditRowComponent,
    DeleteDeviceRowComponent,
    RangeGuardDirective,
  ],
  exports: [
    ValuedisplayComponent,
    StagePresetPickerComponent,
    SetupWizardComponent,
    GrowAssistantCardComponent,
    AuxDevicesComponent,
    ValueEditRowComponent,
    DeleteDeviceRowComponent,
    RangeGuardDirective,
  ],
  imports: [
    CommonModule,
    IonicModule,
    FormsModule,
    PipesModule,
    IonicModule,
    ReactiveFormsModule,
    RouterModule,
    TranslateModule.forChild()
  ]
})
export class ComponentsModule { }
