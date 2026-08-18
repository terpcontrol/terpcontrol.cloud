import { Component, EventEmitter, Input, Output } from '@angular/core';

let nextRowId = 0;

/**
 * One editable numeric setting: a full-width row showing label + value, which
 * expands into a slider/stepper editor below when tapped (the simple-settings
 * editing method). Built to work with screen readers: the row is a real
 * button carrying the label, value and expanded state; the editor is a
 * labelled group whose +/- buttons and slider announce the setting they
 * change.
 */
@Component({
  selector: 'value-edit-row',
  templateUrl: './value-edit-row.component.html',
  styleUrls: ['./value-edit-row.component.scss'],
})
export class ValueEditRowComponent {
  /** Translated label text (not a key — parents often compose units/prefixes). */
  @Input() label = '';
  /** Formatted value including unit, e.g. "24 °C". Falls back to the raw value. */
  @Input() display: string | null = null;
  @Input() value = 0;
  @Output() valueChange = new EventEmitter<number>();
  /** Emitted after every edit — parents hook their save/dirty handling here. */
  @Output() changed = new EventEmitter<void>();
  @Input() min = 0;
  @Input() max = 100;
  @Input() step = 1;
  /** Optional translate key rendered as a help popover next to the label. */
  @Input() helpKey: string | null = null;
  @Input() disabled = false;

  public editing = false;
  public readonly helpTriggerId = `value-edit-row-help-${nextRowId++}`;

  get displayText(): string {
    return this.display ?? String(this.value);
  }

  toggleEditing() {
    if (!this.disabled) {
      this.editing = !this.editing;
    }
  }

  stepBy(direction: number) {
    this.applyValue(this.value + direction * this.step);
  }

  onRangeChange(value: number | { lower: number; upper: number }) {
    if (typeof value === 'number') {
      this.applyValue(value);
    }
  }

  private applyValue(raw: number) {
    const clamped = Math.min(this.max, Math.max(this.min, raw));
    // Avoid float debris from fractional steps (0.1 + 0.2 …).
    const decimals = (String(this.step).split('.')[1] ?? '').length;
    const value = Number(clamped.toFixed(decimals));
    if (value !== this.value) {
      this.value = value;
      this.valueChange.emit(value);
      this.changed.emit();
    }
  }
}
