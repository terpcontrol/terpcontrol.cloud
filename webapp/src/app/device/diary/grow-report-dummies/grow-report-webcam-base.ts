import { Component } from '@angular/core';
import { GrowReportComponent, TimelineDayGroup } from '../grow-report/grow-report.component';

/**
 * Shared webcam-image helpers for the dummy grow report variations.
 * The variations are throwaway prototypes to compare interaction models
 * before one of them is merged into the real grow report.
 *
 * A directive must not extend a component (NG0903), so this abstract base
 * is itself a component with an empty template; it is never rendered.
 */
@Component({ template: '' })
export abstract class GrowReportWebcamBaseComponent extends GrowReportComponent {
  public webcamImageUrl = '';
  public webcamImageDay?: TimelineDayGroup;
  public webcamImageLoading = false;

  private webcamDebounceTimer?: ReturnType<typeof setTimeout>;
  private webcamRequestCounter = 0;

  get timelineDays(): TimelineDayGroup[] {
    const timeline = this.selectedCycleTimeline;
    if (!timeline) {
      return [];
    }

    return timeline.phaseTimeline
      .reduce<TimelineDayGroup[]>((days, phase) => days.concat(phase.eventsByDay), [])
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  showWebcamImageForDay(day: TimelineDayGroup | undefined, debounceMs = 250): void {
    if (!day || this.webcamImageDay?.dayKey === day.dayKey) {
      return;
    }

    this.webcamImageDay = day;
    if (this.webcamDebounceTimer) {
      clearTimeout(this.webcamDebounceTimer);
    }
    this.webcamDebounceTimer = setTimeout(() => void this.loadWebcamImage(day), debounceMs);
  }

  onWebcamImageSettled(): void {
    this.webcamImageLoading = false;
  }

  override ngOnDestroy(): void {
    if (this.webcamDebounceTimer) {
      clearTimeout(this.webcamDebounceTimer);
    }
    super.ngOnDestroy();
  }

  protected override rebuildTimelines(): void {
    super.rebuildTimelines();
    this.onTimelinesRebuilt();
  }

  protected onTimelinesRebuilt(): void {
    const days = this.timelineDays;
    const current = this.webcamImageDay && days.find(day => day.dayKey === this.webcamImageDay?.dayKey);
    this.showWebcamImageForDay(current ?? days[days.length - 1], 0);
  }

  protected async buildDayImageUrl(day: TimelineDayGroup, width: number): Promise<string> {
    const url = await this.devices.getDeviceImageUrl(this.deviceId, 'jpeg', this.dayTimestamp(day));
    return `${url}&width=${width}`;
  }

  // The server returns the newest image taken at or before the requested
  // timestamp, so the end of the day yields that day's last photo.
  protected dayTimestamp(day: TimelineDayGroup): number {
    const endOfDay = new Date(day.date);
    endOfDay.setHours(23, 59, 59, 999);
    return Math.min(endOfDay.getTime(), Date.now());
  }

  private async loadWebcamImage(day: TimelineDayGroup): Promise<void> {
    const requestId = ++this.webcamRequestCounter;
    this.webcamImageLoading = true;
    const url = await this.buildDayImageUrl(day, 800);
    if (requestId !== this.webcamRequestCounter) {
      return;
    }

    this.webcamImageUrl = url;
  }
}
