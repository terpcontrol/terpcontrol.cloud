import { Pipe, PipeTransform } from '@angular/core';
import { NO_VALUE } from '../util/no-value';

@Pipe({
  name: 'round'
})
export class RoundPipe implements PipeTransform {

  transform(value: any, precision?: number, unit = ''): any {
    const numeric = parseFloat(value);
    if (!Number.isFinite(numeric)) {
      return NO_VALUE;
    }
    return numeric.toFixed((!precision || isNaN(precision)) ? 1 : precision) + unit;
  }

}
