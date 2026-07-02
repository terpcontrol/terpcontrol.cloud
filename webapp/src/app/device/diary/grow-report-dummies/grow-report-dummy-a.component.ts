import { Component } from '@angular/core';
import { GrowReportWebcamBaseComponent } from './grow-report-webcam-base';

/**
 * Dummy variation A: the timeline and a sticky webcam panel sit side by side;
 * hovering (or tapping) a day on the timeline updates the photo.
 */
@Component({
  selector: 'app-grow-report-dummy-a',
  templateUrl: './grow-report-dummy-a.component.html',
  styleUrls: ['../grow-report/grow-report.component.scss', './grow-report-dummy-a.component.scss'],
})
export class GrowReportDummyAComponent extends GrowReportWebcamBaseComponent {
}
