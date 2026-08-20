import { Pipe, PipeTransform } from '@angular/core';
import { NO_VALUE } from '../util/no-value';

@Pipe({
  name: 'nofract'
})
export class NoFractPipe implements PipeTransform {

  /** The unit is appended only when there is a value, so "NaN%" cannot happen. */
  transform(value: any, unit = ''): any {
    const numeric = parseFloat(value);
    if (!Number.isFinite(numeric)) {
      return NO_VALUE;
    }
    return numeric.toFixed(0) + unit;
  }

}
