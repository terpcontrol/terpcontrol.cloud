import { Pipe, PipeTransform } from '@angular/core';
import { isMissingValue } from '../util/no-value';

/** Returns a translation key, so callers pipe the result through `translate`. */
@Pipe({
  name: 'onoff'
})
export class OnoffPipe implements PipeTransform {

  transform(value: any): string {
    if (isMissingValue(value)) {
      return 'misc.noValue';
    }
    return Number(value) === 0 ? 'misc.off' : 'misc.on';
  }

}
