import { Component } from '@angular/core';
import { GrowReportWebcamBaseComponent } from './grow-report-webcam-base';
import { TimelineDayGroup } from '../grow-report/grow-report.component';

/**
 * Dummy variation B: each timeline day gets a camera button that expands
 * that day's webcam photo inline; a toggle expands all days at once.
 */
@Component({
  selector: 'app-grow-report-dummy-b',
  templateUrl: './grow-report-dummy-b.component.html',
  styleUrls: ['../grow-report/grow-report.component.scss', './grow-report-dummy-b.component.scss'],
})
export class GrowReportDummyBComponent extends GrowReportWebcamBaseComponent {
  public expandedDayKeys = new Set<string>();
  public dayImageUrls: Record<string, string> = {};
  public showAllPhotos = false;

  isDayExpanded(day: TimelineDayGroup): boolean {
    return this.showAllPhotos || this.expandedDayKeys.has(day.dayKey);
  }

  toggleDayPhoto(day: TimelineDayGroup): void {
    if (this.showAllPhotos) {
      this.showAllPhotos = false;
      this.expandedDayKeys = new Set(this.timelineDays.map(d => d.dayKey));
      this.expandedDayKeys.delete(day.dayKey);
      return;
    }

    if (this.expandedDayKeys.has(day.dayKey)) {
      this.expandedDayKeys.delete(day.dayKey);
    } else {
      this.expandedDayKeys.add(day.dayKey);
      void this.ensureDayImage(day);
    }
  }

  onShowAllPhotosChanged(event: any): void {
    this.showAllPhotos = !!event.detail.checked;
    if (!this.showAllPhotos) {
      this.expandedDayKeys.clear();
      return;
    }

    for (const day of this.timelineDays) {
      void this.ensureDayImage(day);
    }
  }

  protected override onTimelinesRebuilt(): void {
    for (const day of this.timelineDays) {
      if (this.isDayExpanded(day)) {
        void this.ensureDayImage(day);
      }
    }
  }

  private async ensureDayImage(day: TimelineDayGroup): Promise<void> {
    if (this.dayImageUrls[day.dayKey]) {
      return;
    }

    this.dayImageUrls[day.dayKey] = await this.buildDayImageUrl(day, 640);
  }
}
