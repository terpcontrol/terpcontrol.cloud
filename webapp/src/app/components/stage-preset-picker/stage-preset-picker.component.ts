import { Component, EventEmitter, Input, Output } from '@angular/core';
import { GROW_STAGE_PRESETS, GrowStagePreset, StageSelection } from 'src/app/util/grow-presets';

@Component({
  selector: 'stage-preset-picker',
  templateUrl: './stage-preset-picker.component.html',
  styleUrls: ['./stage-preset-picker.component.scss'],
})
export class StagePresetPickerComponent {
  @Input() selected: StageSelection | null = null;
  /** Adds an "own values" card that just marks the selection as custom. */
  @Input() showCustom = false;
  /** Adds an "off" card, so switching the regulation off is a stage choice too. */
  @Input() showOff = false;
  @Output() selectedChange = new EventEmitter<StageSelection>();

  public presets = GROW_STAGE_PRESETS.filter(preset => preset.showInPicker);

  select(id: StageSelection) {
    this.selected = id;
    this.selectedChange.emit(id);
  }

  subtitle(preset: GrowStagePreset): string {
    if (preset.workmode === 'dry') {
      return `${preset.nightTemperature} °C · ${preset.nightHumidity} %`;
    }
    return `${preset.dayTemperature}/${preset.nightTemperature} °C · ${preset.dayHumidity} % · ${preset.lightHours} h`;
  }
}
