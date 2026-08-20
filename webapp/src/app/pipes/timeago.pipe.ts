import { Pipe, PipeTransform } from '@angular/core';
import { formatTimeAgo } from '../util/time-ago';

@Pipe({
  name: 'timeAgo',
  pure: true
})
export class TimeAgoPipe implements PipeTransform {

  transform(value: Date | string | number): string {
    return formatTimeAgo(value);
  }

}
