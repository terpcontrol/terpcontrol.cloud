import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ValuedisplayComponent } from './valuedisplay/valuedisplay.component';
import { StagePresetPickerComponent } from './stage-preset-picker/stage-preset-picker.component';
import { SetupWizardComponent } from './setup-wizard/setup-wizard.component';
import { GrowAssistantCardComponent } from './grow-assistant/grow-assistant-card.component';
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
    RangeGuardDirective,
  ],
  exports: [
    ValuedisplayComponent,
    StagePresetPickerComponent,
    SetupWizardComponent,
    GrowAssistantCardComponent,
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
