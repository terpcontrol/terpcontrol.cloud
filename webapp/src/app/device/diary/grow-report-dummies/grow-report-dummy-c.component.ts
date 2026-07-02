import { Component, ElementRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DeviceService } from '../../../services/devices.service';
import { GrowReportWebcamBaseComponent } from './grow-report-webcam-base';
import { TimelineDayGroup } from '../grow-report/grow-report.component';

const MANUAL_SCRUB_HOLDOFF_MS = 2500;

/**
 * Dummy variation C: a floating viewer (toggled by a button) shows the
 * webcam photo with a day slider. Scrolling the timeline keeps the photo
 * in sync; scrubbing the slider scrolls the timeline to the matching day.
 */
@Component({
  selector: 'app-grow-report-dummy-c',
  templateUrl: './grow-report-dummy-c.component.html',
  styleUrls: ['../grow-report/grow-report.component.scss', './grow-report-dummy-c.component.scss'],
})
export class GrowReportDummyCComponent extends GrowReportWebcamBaseComponent {
  public viewerOpen = false;
  public scrubIndex = 0;

  private observer?: IntersectionObserver;
  private lastManualScrubAt = 0;

  constructor(devices: DeviceService, router: Router, route: ActivatedRoute, private elementRef: ElementRef<HTMLElement>) {
    super(devices, router, route);
  }

  toggleViewer(): void {
    this.viewerOpen = !this.viewerOpen;
    if (this.viewerOpen) {
      this.syncScrubIndexToImageDay();
      this.setupScrollSync();
    }
  }

  onScrub(event: any): void {
    const index = Number(event.detail.value);
    const day = this.timelineDays[index];
    if (!day || index === this.scrubIndex) {
      return;
    }

    this.scrubIndex = index;
    this.lastManualScrubAt = Date.now();
    this.showWebcamImageForDay(day, 150);
    this.scrollTimelineToDay(day);
  }

  override ngOnDestroy(): void {
    this.observer?.disconnect();
    super.ngOnDestroy();
  }

  protected override onTimelinesRebuilt(): void {
    super.onTimelinesRebuilt();
    this.syncScrubIndexToImageDay();
    this.setupScrollSync();
  }

  // Track which day is visible while the user scrolls the timeline and keep
  // the floating viewer in sync with it.
  private setupScrollSync(): void {
    setTimeout(() => {
      this.observer?.disconnect();
      const dayElements = this.elementRef.nativeElement.querySelectorAll('.day-section[data-day-key]');
      if (!dayElements.length) {
        return;
      }

      this.observer = new IntersectionObserver(entries => this.onDaysScrolledIntoView(entries), {
        rootMargin: '-20% 0px -60% 0px',
      });
      dayElements.forEach(element => this.observer?.observe(element));
    });
  }

  private onDaysScrolledIntoView(entries: IntersectionObserverEntry[]): void {
    if (!this.viewerOpen || Date.now() - this.lastManualScrubAt < MANUAL_SCRUB_HOLDOFF_MS) {
      return;
    }

    const visible = entries.find(entry => entry.isIntersecting);
    if (!visible) {
      return;
    }

    const dayKey = (visible.target as HTMLElement).dataset['dayKey'];
    const days = this.timelineDays;
    const index = days.findIndex(day => day.dayKey === dayKey);
    if (index < 0) {
      return;
    }

    this.scrubIndex = index;
    this.showWebcamImageForDay(days[index], 300);
  }

  private scrollTimelineToDay(day: TimelineDayGroup): void {
    const element = this.elementRef.nativeElement.querySelector(`.day-section[data-day-key="${CSS.escape(day.dayKey)}"]`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  private syncScrubIndexToImageDay(): void {
    const index = this.timelineDays.findIndex(day => day.dayKey === this.webcamImageDay?.dayKey);
    this.scrubIndex = index >= 0 ? index : Math.max(0, this.timelineDays.length - 1);
  }
}
