import { Component, Input } from '@angular/core';

@Component({
  selector: 'webcam-image',
  templateUrl: './webcam-image.component.html',
  styleUrls: ['./webcam-image.component.scss'],
})
export class WebcamImageComponent {
  @Input() src = '';
  @Input() alt = 'Device Image';
  // Capture time of the shown image when it is too old for the device to still
  // count as online. Null keeps the picture uncovered.
  @Input() offlineSince: number | null = null;
}
