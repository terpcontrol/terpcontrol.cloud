import {Component, ElementRef, Input, NgZone, OnChanges, OnDestroy, OnInit, SimpleChanges} from '@angular/core';
import {DeviceService} from "../../../services/devices.service";
import {Subscription} from "rxjs";
import {collectLogCategories, filterLogsByCategory, LogEntryViewerLog} from "../../log-entry-viewer/log-entry-viewer.component";
import {ActivatedRoute, Router} from "@angular/router";
import type { DiaryEntryData, DeviceLog } from '@fg2/shared-types';
import {
  DEFAULT_GROW_CATEGORIES,
  mergeDiaryQueryParams,
  parseNumberQueryParam,
  parseStringArrayQueryParam,
  serializeNumberQueryParam,
  serializeStringArrayQueryParam,
} from '../diary-query-params';

export const LIFECYCLE_EVENT_ORDER: Record<DiaryEntryData['newLifecycleStage'], number> = {
  germination: 0,
  seedling: 1,
  vegetative: 2,
  flowering: 3,
  drying: 4,
  curing: 5,
} as const;

export type GrowCycle = {
  name: string;
  timestampStart: Date;
  timestampEnd?: Date;
  events: Partial<Record<DiaryEntryData['newLifecycleStage'], DeviceLog>>;
}

type TimelineEvent = {
  log: LogEntryViewerLog;
  time: Date;
  stage: DiaryEntryData['newLifecycleStage'];
  isLifecycle: boolean;
};

type TimelineDayGroup = {
  dayKey: string;
  date: Date;
  dayNumberInCycle: number;
  dayNumberInPhase: number;
  events: TimelineEvent[];
  gapToNextDays?: number;
  gapLabel?: string;
  gapHeightPx?: number;
  gapDayFractions?: number[];
};

type TimelinePhaseGroup = {
  stage: DiaryEntryData['newLifecycleStage'];
  eventsByDay: TimelineDayGroup[];
};

type PhaseSummary = {
  stage: DiaryEntryData['newLifecycleStage'];
  startDate: Date;
  durationDays: number;
  totalDaysFromStart: number;
};

type GrowCycleTimeline = GrowCycle & {
  phaseTimeline: TimelinePhaseGroup[];
  phaseSummaries: PhaseSummary[];
  lastEventDate?: Date;
};

// One calendar day of the selected cycle, scrubbable in the webcam viewer.
// Unlike TimelineDayGroup this also covers days without any entries.
type WebcamScrubDay = {
  dayKey: string;
  date: Date;
  dayNumberInCycle: number;
  hasEvents: boolean;
};

const WEBCAM_MANUAL_SCRUB_HOLDOFF_MS = 2500;
// Radius in px within which the timeline marker clamps to a day with entries.
const WEBCAM_ENTRY_SNAP_PX = 10;
// Minimum time the marker stays on a day while catching up with scrolling.
const WEBCAM_STEP_INTERVAL_MS = 90;

@Component({
  selector: 'app-grow-report',
  templateUrl: './grow-report.component.html',
  styleUrls: ['./grow-report.component.scss'],
})
export class GrowReportComponent implements OnInit, OnDestroy, OnChanges {
  @Input() deviceId = '';
  @Input() lastUpdated: number | undefined;
  @Input() isPublic = false;

  private devicesSubscription: Subscription | undefined;
  private queryParamsSubscription: Subscription | undefined;
  private requestedCycleStart?: number;

  public growCycles: GrowCycle[] = [];
  public cycleTimelines: GrowCycleTimeline[] = [];
  public selectedCycleIndex: number = 0;
  public loading = false;
  public availableLogCategories: string[] = [];
  public selectedLogCategories: string[] = ['device-configuration', 'recipe', 'diary'];

  public webcamViewerOpen = false;
  public webcamScrubIndex = 0;
  public webcamScrubDays: WebcamScrubDay[] = [];
  public webcamImageUrl = '';
  public webcamImageDay?: WebcamScrubDay;
  public webcamImageLoading = false;
  public webcamMarkerTop: number | null = null;
  public webcamMarkerDragging = false;

  private webcamDebounceTimer?: ReturnType<typeof setTimeout>;
  private webcamRequestCounter = 0;
  private lastManualScrubAt = 0;
  private scrollRafPending = false;
  private webcamStepTimer?: ReturnType<typeof setTimeout>;
  private lastWebcamStepAt = 0;
  private ionScrollElement?: HTMLElement;
  private destroyed = false;

  private allLogs: LogEntryViewerLog[] = [];
  private lifecycleLogs: LogEntryViewerLog[] = [];
  private static readonly LIFECYCLE_CATEGORIES = ['diary-plant-lifecycle', 'plant-lifecycle'] as const;

  constructor(
    private devices: DeviceService,
    private router: Router,
    private route: ActivatedRoute,
    private elementRef: ElementRef<HTMLElement>,
    private zone: NgZone,
  ) {
  }

  ngOnInit() {
    // Scroll listeners are registered outside the zone so plain scrolling
    // doesn't trigger change detection. Scroll events don't escape the
    // ion-content shadow root, so its scroller needs its own listener next
    // to the document-level one.
    this.zone.runOutsideAngular(() => {
      document.addEventListener('scroll', this.onDocumentScroll, true);
    });
    void this.attachIonContentScrollListener();

    this.queryParamsSubscription = this.route.queryParamMap.subscribe(params => {
      this.selectedLogCategories = parseStringArrayQueryParam(params.get('growCategories')) ?? [...DEFAULT_GROW_CATEGORIES];
      this.requestedCycleStart = parseNumberQueryParam(params.get('growCycle'));

      if (this.growCycles.length > 0) {
        this.ensureSelectedCategories();
        this.applyRequestedCycleSelection();
        this.rebuildTimelines();
      }
    });

    this.devicesSubscription = this.devices.devices.subscribe(async() => {
      void this.loadData();
    });
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.devicesSubscription?.unsubscribe();
    this.queryParamsSubscription?.unsubscribe();
    document.removeEventListener('scroll', this.onDocumentScroll, true);
    this.ionScrollElement?.removeEventListener('scroll', this.onDocumentScroll);
    this.cancelWebcamScrollAnimation();
    if (this.webcamDebounceTimer) {
      clearTimeout(this.webcamDebounceTimer);
    }
  }

  private async attachIonContentScrollListener(): Promise<void> {
    const content = this.elementRef.nativeElement.closest('ion-content') as any;
    if (typeof content?.getScrollElement !== 'function') {
      return;
    }

    const scrollElement: HTMLElement = await content.getScrollElement();
    if (this.destroyed) {
      return;
    }

    this.ionScrollElement = scrollElement;
    this.zone.runOutsideAngular(() => {
      scrollElement.addEventListener('scroll', this.onDocumentScroll, { passive: true });
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    if ((changes['lastUpdated'] && !changes['lastUpdated'].firstChange)
      || (changes['deviceId'] && !changes['deviceId'].firstChange)) {
      void this.loadData();
    }
  }

  async loadData() {
    if (!this.deviceId) {
      this.growCycles = [];
      this.cycleTimelines = [];
      this.availableLogCategories = [];
      this.selectedLogCategories = [];
      this.selectedCycleIndex = 0;
      this.rebuildWebcamScrubDays();
      return;
    }

    this.loading = true;
    try {
      const lifecycleLogs = await this.devices.getLogs(
        this.deviceId,
        undefined,
        undefined,
        true,
        [...GrowReportComponent.LIFECYCLE_CATEGORIES]
      );

      this.lifecycleLogs = lifecycleLogs.filter(log => !!log.data?.newLifecycleStage);
      this.growCycles = this.convertEventsToGrowCycles(this.lifecycleLogs);

      if (!this.lifecycleLogs.length) {
        this.allLogs = [];
        this.cycleTimelines = [];
        this.availableLogCategories = [];
        this.selectedLogCategories = [];
        this.selectedCycleIndex = 0;
        this.rebuildWebcamScrubDays();
        return;
      }

      const timeframe = this.getLifecycleTimeframe();
      const logs = await this.devices.getLogs(
        this.deviceId,
        timeframe.timestampFrom,
        timeframe.timestampTo,
        true
      );

      this.allLogs = logs;
      this.availableLogCategories = collectLogCategories(logs);
      this.ensureSelectedCategories();
      this.applyRequestedCycleSelection();
      this.rebuildTimelines();
      void this.syncQueryParams();
    } finally {
      this.loading = false;
    }
  }

  private getLifecycleTimeframe(): { timestampFrom: number; timestampTo: number } {
    const lifecycleTimestamps = this.lifecycleLogs
      .map(log => new Date(log.time).getTime())
      .filter(timestamp => Number.isFinite(timestamp));

    const cycleStartTimestamps = this.growCycles
      .map(cycle => new Date(cycle.timestampStart).getTime())
      .filter(timestamp => Number.isFinite(timestamp));

    const cycleEndTimestamps = this.growCycles
      .map(cycle => cycle.timestampEnd ? new Date(cycle.timestampEnd).getTime() : Date.now())
      .filter(timestamp => Number.isFinite(timestamp));

    const fallbackNow = Date.now();
    const timestampFrom = Math.min(...(lifecycleTimestamps.length > 0 ? lifecycleTimestamps : cycleStartTimestamps.length > 0 ? cycleStartTimestamps : [fallbackNow]));
    const timestampTo = Math.max(...(cycleEndTimestamps.length > 0 ? cycleEndTimestamps : lifecycleTimestamps.length > 0 ? lifecycleTimestamps : [fallbackNow]));

    return {
      timestampFrom: Math.min(timestampFrom, timestampTo),
      timestampTo: Math.max(timestampFrom, timestampTo),
    };
  }

  onCategoryChanged(selectedCategories?: string[]): void {
    this.selectedLogCategories = selectedCategories && selectedCategories.length > 0
      ? selectedCategories
      : (this.availableLogCategories.includes('diary') ? ['diary'] : []);
    this.rebuildTimelines();
    void this.syncQueryParams();
  }

  private ensureSelectedCategories(): void {
    if (!this.availableLogCategories.length) {
      this.selectedLogCategories = [];
      return;
    }

    if (!this.selectedLogCategories.length || !this.selectedLogCategories.some(cat => this.availableLogCategories.includes(cat))) {
      this.selectedLogCategories = this.availableLogCategories.includes('diary') ? ['diary'] : [...this.availableLogCategories];
    }
  }

  private applyRequestedCycleSelection(): void {
    if (!this.growCycles.length) {
      this.selectedCycleIndex = 0;
      return;
    }

    if (this.requestedCycleStart !== undefined) {
      const requestedIndex = this.growCycles.findIndex(cycle => new Date(cycle.timestampStart).getTime() === this.requestedCycleStart);
      if (requestedIndex >= 0) {
        this.selectedCycleIndex = requestedIndex;
        return;
      }
    }

    this.selectedCycleIndex = Math.min(this.selectedCycleIndex, this.growCycles.length - 1);
  }

  private rebuildTimelines(): void {
    const filtered = filterLogsByCategory(this.allLogs, this.selectedLogCategories);
    const merged = this.mergeLifecycleLogs(filtered).sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    // Pre-calculate gaps between consecutive days across all logs
    const dayGaps = this.calculateDayGaps(merged);

    this.cycleTimelines = this.growCycles.map((cycle) => this.buildTimelineForCycle(cycle, merged, dayGaps));
    this.rebuildWebcamScrubDays();
    this.scheduleWebcamMarkerUpdate();
  }

  private calculateDayGaps(logs: LogEntryViewerLog[]): Map<string, { gapToNextDays: number; gapLabel: string }> {
    const dayGaps = new Map<string, { gapToNextDays: number; gapLabel: string }>();

    // Get unique days sorted chronologically
    const uniqueDays: Date[] = [];
    const seenDays = new Set<string>();

    for (const log of logs) {
      const dayDate = this.toStartOfDay(new Date(log.time));
      const dayKey = this.toDayKey(dayDate);
      if (!seenDays.has(dayKey)) {
        seenDays.add(dayKey);
        uniqueDays.push(dayDate);
      }
    }

    uniqueDays.sort((a, b) => a.getTime() - b.getTime());

    // Calculate gaps between consecutive days
    for (let i = 0; i < uniqueDays.length; i++) {
      const currentDay = uniqueDays[i];
      const nextDay = i < uniqueDays.length - 1 ? uniqueDays[i + 1] : new Date(); // Compare last day to today
      const gapDays = this.calculateDayCount(currentDay, nextDay);
      if (gapDays > 0) {
        const dayKey = this.toDayKey(currentDay);
        dayGaps.set(dayKey, {
          gapToNextDays: gapDays,
          gapLabel: this.formatGapLabel(gapDays),
        });
      }
    }

    return dayGaps;
  }

  private mergeLifecycleLogs(logs: LogEntryViewerLog[]): LogEntryViewerLog[] {
    const merged: LogEntryViewerLog[] = [...logs] as LogEntryViewerLog[];
    const ids = new Set(merged.map(log => log._id));
    this.lifecycleLogs.forEach(log => {
      if (!ids.has(log._id)) {
        merged.push(log as LogEntryViewerLog);
      }
    });
    return merged;
  }

  private buildTimelineForCycle(
    cycle: GrowCycle,
    logs: LogEntryViewerLog[],
    dayGaps: Map<string, { gapToNextDays: number; gapLabel: string }>
  ): GrowCycleTimeline {
    const cycleStart = new Date(cycle.timestampStart);
    const nextCycleStart = this.findNextCycleStart(cycleStart);
    const cycleEnd = nextCycleStart
      ? new Date(nextCycleStart)
      : (cycle.timestampEnd ? new Date(cycle.timestampEnd) : undefined);

    const lifecycleEvents = this.lifecycleLogs
      .filter(log => this.isWithinCycle(log.time, cycleStart, cycleEnd) && log.data?.newLifecycleStage)
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    const eventsInCycle: TimelineEvent[] = logs
      .filter(log => this.isWithinCycle(log.time, cycleStart, cycleEnd))
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
      .map(log => ({
        log: log as LogEntryViewerLog,
        time: new Date(log.time),
        stage: this.getStageForTime(new Date(log.time), lifecycleEvents),
        isLifecycle: this.isLifecycleLog(log),
      }))
      .filter(item => !!item.stage) as TimelineEvent[];

    const phaseMap = new Map<DiaryEntryData['newLifecycleStage'], TimelinePhaseGroup>();
    const phaseTimeline: TimelinePhaseGroup[] = [];

    for (const event of eventsInCycle) {
      const stage = event.stage as DiaryEntryData['newLifecycleStage'];
      let phaseGroup = phaseMap.get(stage);
      if (!phaseGroup) {
        phaseGroup = { stage, eventsByDay: [] };
        phaseMap.set(stage, phaseGroup);
        phaseTimeline.push(phaseGroup);
      }

      const dayKey = this.toDayKey(event.time);
      let dayGroup = phaseGroup.eventsByDay.find(day => day.dayKey === dayKey);
      if (!dayGroup) {
        const dayDate = this.toStartOfDay(event.time);
        const gap = dayGaps.get(dayKey);
        dayGroup = {
          dayKey,
          date: dayDate,
          dayNumberInCycle: this.calculateDayCount(this.toStartOfDay(cycleStart), dayDate) + 1,
          dayNumberInPhase: 0, // Will be calculated after sorting
          events: [],
          gapToNextDays: gap?.gapToNextDays,
          gapLabel: gap?.gapLabel,
          gapHeightPx: gap ? this.gapLineHeightPx(gap.gapToNextDays) : undefined,
          gapDayFractions: gap ? this.gapDayFractions(gap.gapToNextDays) : undefined,
        };
        phaseGroup.eventsByDay.push(dayGroup);
      }

      dayGroup.events.push(event);
    }

    // Sort days within each phase and calculate dayNumberInPhase
    for (const phase of phaseTimeline) {
      phase.eventsByDay.sort((a, b) => a.date.getTime() - b.date.getTime());

      // Calculate day number in phase based on actual day difference from first day
      if (phase.eventsByDay.length > 0) {
        const firstDayInPhase = phase.eventsByDay[0].date;
        for (const day of phase.eventsByDay) {
          day.dayNumberInPhase = this.calculateDayCount(firstDayInPhase, day.date) + 1;
        }
      }
    }

    return {
      ...cycle,
      phaseTimeline,
      phaseSummaries: this.buildPhaseSummaries(phaseTimeline, cycleStart),
      lastEventDate: eventsInCycle.length > 0 ? eventsInCycle[eventsInCycle.length - 1].time : undefined,
    };
  }

  private findNextCycleStart(cycleStart: Date): Date | undefined {
    const currentStartTime = cycleStart.getTime();
    let nextStart: Date | undefined;

    for (const cycle of this.growCycles) {
      const start = new Date(cycle.timestampStart);
      if (start.getTime() <= currentStartTime) {
        continue;
      }

      if (!nextStart || start.getTime() < nextStart.getTime()) {
        nextStart = start;
      }
    }

    return nextStart;
  }

  private buildPhaseSummaries(phaseTimeline: TimelinePhaseGroup[], cycleStart: Date): PhaseSummary[] {
    const summaries: PhaseSummary[] = [];
    const today = this.toStartOfDay(new Date());

    for (let i = 0; i < phaseTimeline.length; i++) {
      const phase = phaseTimeline[i];

      const firstDay = phase.eventsByDay[0];
      if (!firstDay) {
        continue;
      }

      const startDate = firstDay.date;
      const phaseStartAnchor = this.getPhaseStartAnchor(phase, startDate);
      const nextLifecycleEventDate = this.findNextLifecycleEventDate(phaseStartAnchor);
      const endDate = phase.stage === 'curing'
        ? today
        : (nextLifecycleEventDate ? this.toStartOfDay(nextLifecycleEventDate) : today);

      const durationDays = this.calculateDayCount(startDate, endDate);
      const totalDaysFromStart = this.calculateDayCount(this.toStartOfDay(cycleStart), startDate) + 1;

      summaries.push({
        stage: phase.stage,
        startDate,
        durationDays: Math.max(1, durationDays),
        totalDaysFromStart,
      });
    }

    return summaries;
  }

  private getPhaseStartAnchor(phase: TimelinePhaseGroup, fallbackStartDate: Date): Date {
    for (const day of phase.eventsByDay) {
      const lifecycleEvent = day.events.find(event => event.isLifecycle && event.stage === phase.stage);
      if (lifecycleEvent) {
        return lifecycleEvent.time;
      }
    }

    const firstEvent = phase.eventsByDay[0]?.events[0];
    return firstEvent ? firstEvent.time : fallbackStartDate;
  }

  private findNextLifecycleEventDate(currentStageStart: Date): Date | undefined {
    const currentStartTime = new Date(currentStageStart).getTime();
    let nextEvent: Date | undefined;

    for (const log of this.lifecycleLogs) {
      const logTime = new Date(log.time);
      const timestamp = logTime.getTime();
      if (timestamp <= currentStartTime) {
        continue;
      }

      if (!nextEvent || timestamp < nextEvent.getTime()) {
        nextEvent = logTime;
      }
    }

    return nextEvent;
  }

  private formatGapLabelUntilToday(days: number): string {
    if (days <= 0) {
      return '';
    }

    const weeks = Math.floor(days / 7);
    const remainingDays = days % 7;
    const parts: string[] = [];

    if (weeks > 0) {
      parts.push(`${weeks} ${weeks === 1 ? 'week' : 'weeks'}`);
    }

    if (remainingDays > 0) {
      parts.push(`${remainingDays} ${remainingDays === 1 ? 'day' : 'days'}`);
    }

    return parts.join(' ') + ' until today';
  }

  scrollToPhase(stage: DiaryEntryData['newLifecycleStage']): void {
    const element = document.getElementById('phase-' + stage);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  navigateToCharts(summary: PhaseSummary): void {
    const timeline = this.selectedCycleTimeline;
    if (!timeline || !this.deviceId) {
      return;
    }

    const phase = timeline.phaseTimeline.find(p => p.stage === summary.stage);
    if (!phase || !phase.eventsByDay.length) {
      return;
    }

    const startDate = summary.startDate;

    // Find the end date: either next phase start or last event in this phase + 1 day
    const currentIndex = timeline.phaseTimeline.indexOf(phase);
    const nextPhase = timeline.phaseTimeline[currentIndex + 1];

    let endDate: Date;
    if (nextPhase && nextPhase.eventsByDay[0]) {
      endDate = nextPhase.eventsByDay[0].date;
    } else {
      const lastDay = phase.eventsByDay[phase.eventsByDay.length - 1];
      endDate = new Date(lastDay.date);
      endDate.setDate(endDate.getDate() + 1);
    }

    this.navigateToChartsWithDateRange(startDate, endDate);
  }

  navigateToChartsForCycle(): void {
    const timeline = this.selectedCycleTimeline;
    if (!timeline || !this.deviceId) {
      return;
    }

    const startDate = timeline.timestampStart;

    // End date is either the cycle end date, last event date + 1 day, or now
    let endDate: Date;
    if (timeline.timestampEnd) {
      endDate = new Date(timeline.timestampEnd);
    } else if (timeline.lastEventDate) {
      endDate = new Date(timeline.lastEventDate);
      endDate.setDate(endDate.getDate() + 1);
    } else {
      endDate = new Date();
    }

    this.navigateToChartsWithDateRange(startDate, endDate);
  }

  private navigateToChartsWithDateRange(startDate: Date, endDate: Date): void {
    const queryParams = {
      date: startDate.toISOString(),
      dateEnd: endDate.toISOString(),
      measures: 'temperature,image,logs',
      useCustom: 'true',
      vpdMode: 'day',
      interval: '1h',
      logs: this.selectedLogCategories?.join(',') || '',
    };

    void this.router.navigate(['device', this.deviceId, 'charts'], { queryParams });
  }

  private isWithinCycle(time: string | number | Date, start: Date, end?: Date): boolean {
    const timestamp = new Date(time).getTime();
    const startTime = start.getTime();
    const endTime = end ? new Date(end).getTime() : undefined;

    return timestamp >= startTime && (endTime === undefined || timestamp < endTime);
  }

  private toDayKey(date: Date): string {
    return this.toStartOfDay(date).toISOString();
  }

  private toStartOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private getStageForTime(time: Date, lifecycleEvents: DeviceLog[]): DiaryEntryData['newLifecycleStage'] | undefined {
    let currentStage = lifecycleEvents[0]?.data?.newLifecycleStage;

    for (const lifecycleEvent of lifecycleEvents) {
      const lifecycleTime = new Date(lifecycleEvent.time);
      if (lifecycleTime.getTime() <= time.getTime() && lifecycleEvent.data?.newLifecycleStage) {
        currentStage = lifecycleEvent.data.newLifecycleStage;
      } else {
        break;
      }
    }

    return currentStage;
  }

  private convertEventsToGrowCycles(entries: DeviceLog[]): GrowCycle[] {
    const sortedEntries = [...entries].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    const cycles: GrowCycle[] = [];

    let previousLifecycleOrder: number | undefined = undefined;
    let currentCycle: GrowCycle | null = null;

    for (const entry of sortedEntries) {
      const stage = entry.data?.newLifecycleStage;
      if (!stage) {
        continue;
      }

      const lifecycleOrder = (LIFECYCLE_EVENT_ORDER as Record<string, number | undefined>)[stage];
      if (lifecycleOrder === undefined) {
        continue;
      }

      const currentLifecycleName = currentCycle?.name?.trim() || '';
      const entryLifecycleName = entry.data?.lifecycleName?.trim() || '';
      const hasNameBoundary = !!currentCycle
        && !!currentLifecycleName
        && !!entryLifecycleName
        && entryLifecycleName !== currentLifecycleName;
      const hasOrderRollback = previousLifecycleOrder !== undefined && lifecycleOrder < previousLifecycleOrder;
      const startNewCycle = !!currentCycle && (hasNameBoundary || hasOrderRollback);

      if (!currentCycle || startNewCycle) {
        if (currentCycle) {
          currentCycle.timestampEnd = new Date(entry.time);
        }

        currentCycle = {
          timestampStart: new Date(entry.time),
          timestampEnd: undefined,
          events: {},
          name: entry.data?.lifecycleName || '',
        };
        cycles.push(currentCycle);
      }

      currentCycle.events[stage] = entry;
      if (!currentCycle.name) {
        currentCycle.name = entry.data?.lifecycleName || '';
      }

      previousLifecycleOrder = lifecycleOrder;
    }

    for (let i = 0; i < cycles.length; i++) {
      if (!cycles[i].name) {
        cycles[i].name = 'My Strain ' + (i + 1);
      }
    }

    return cycles.reverse();
  }

  get selectedCycle(): GrowCycle | undefined {
    return this.growCycles.length > 0 ? this.growCycles[Math.min(this.selectedCycleIndex, this.growCycles.length - 1)] : undefined;
  }

  get selectedCycleTimeline(): GrowCycleTimeline | undefined {
    return this.cycleTimelines.length > 0 ? this.cycleTimelines[Math.min(this.selectedCycleIndex, this.cycleTimelines.length - 1)] : undefined;
  }

  get totalEventsInSelectedCycle(): number {
    const timeline = this.selectedCycleTimeline;
    if (!timeline) {
      return 0;
    }

    return timeline.phaseTimeline.reduce((sum, phase) => sum + phase.eventsByDay.reduce((count, day) => count + day.events.length, 0), 0);
  }

  private calculateDayCount(startDate: Date, endDate: Date): number {
    const start = new Date(startDate);
    const end = new Date(endDate);

    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    const diffTime = end.getTime() - start.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    return Math.max(0, diffDays);
  }

  private formatGapLabel(days: number): string {
    if (days <= 0) {
      return '';
    }

    const weeks = Math.floor(days / 7);
    const remainingDays = days % 7;
    const parts: string[] = [];

    if (weeks > 0) {
      parts.push(`${weeks} ${weeks === 1 ? 'week' : 'weeks'}`);
    }

    if (remainingDays > 0) {
      parts.push(`${remainingDays} ${remainingDays === 1 ? 'day' : 'days'}`);
    }

    return parts.join(' ') + ' later';
  }

  private isLifecycleLog(log: DeviceLog): boolean {
    return Array.isArray(log.categories)
      && GrowReportComponent.LIFECYCLE_CATEGORIES.some(category => log.categories?.includes(category));
  }

  // The gap line grows with the elapsed time, sub-linearly and capped so
  // long pauses don't dominate the timeline.
  private gapLineHeightPx(gapDays: number): number {
    return Math.min(48 + Math.round(56 * Math.log2(Math.max(1, gapDays))), 280);
  }

  // Positions of the in-between days along the gap line, matching the webcam
  // day anchors; omitted when the days would be too dense to render.
  private gapDayFractions(gapDays: number): number[] | undefined {
    const inBetween = gapDays - 1;
    if (inBetween <= 0 || inBetween > this.gapLineHeightPx(gapDays) / 7) {
      return undefined;
    }

    return Array.from({ length: inBetween }, (_, index) => (index + 0.5) / inBetween);
  }

  toggleWebcamViewer(): void {
    this.webcamViewerOpen = !this.webcamViewerOpen;
    this.scheduleWebcamMarkerUpdate();
  }

  openWebcamViewerAtGap(event: MouseEvent): void {
    this.webcamViewerOpen = true;
    this.scrubToClientY(event.clientY, 0);
  }

  onScrubStripPointerMove(event: PointerEvent): void {
    // Hovering scrubs with the mouse; touch input still scrolls normally
    // and uses taps or the marker instead.
    if (event.pointerType !== 'mouse') {
      return;
    }

    this.scrubToClientY(event.clientY, 200);
  }

  onScrubStripClick(event: MouseEvent): void {
    this.scrubToClientY(event.clientY, 0);
  }

  onWebcamScrub(event: any): void {
    const index = Number(event.detail.value);
    const day = this.webcamScrubDays[index];
    if (!day || index === this.webcamScrubIndex) {
      return;
    }

    this.cancelWebcamScrollAnimation();
    this.webcamScrubIndex = index;
    this.lastManualScrubAt = Date.now();
    this.showWebcamImageForDay(day, 150);
    this.scrollTimelineToDay(day);
  }

  onWebcamImageSettled(): void {
    this.webcamImageLoading = false;
  }

  private rebuildWebcamScrubDays(): void {
    const timeline = this.selectedCycleTimeline;
    if (!timeline) {
      this.webcamScrubDays = [];
      this.webcamScrubIndex = 0;
      this.webcamImageDay = undefined;
      return;
    }

    const start = this.toStartOfDay(new Date(timeline.timestampStart));
    const endSource = timeline.timestampEnd ? new Date(timeline.timestampEnd).getTime() : Date.now();
    const end = this.toStartOfDay(new Date(Math.min(endSource, Date.now())));

    const eventDayKeys = new Set(
      timeline.phaseTimeline.flatMap(phase => phase.eventsByDay.map(day => day.dayKey))
    );

    const days: WebcamScrubDay[] = [];
    for (const cursor = new Date(start); cursor.getTime() <= end.getTime() && days.length < 3660; cursor.setDate(cursor.getDate() + 1)) {
      const date = new Date(cursor);
      const dayKey = this.toDayKey(date);
      days.push({
        dayKey,
        date,
        dayNumberInCycle: this.calculateDayCount(start, date) + 1,
        hasEvents: eventDayKeys.has(dayKey),
      });
    }

    this.webcamScrubDays = days;

    const currentIndex = this.webcamImageDay ? days.findIndex(day => day.dayKey === this.webcamImageDay?.dayKey) : -1;
    this.webcamScrubIndex = currentIndex >= 0 ? currentIndex : 0;
    this.showWebcamImageForDay(days[this.webcamScrubIndex], 0);
  }

  onWebcamMarkerPointerDown(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.webcamMarkerDragging = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  onWebcamMarkerPointerMove(event: PointerEvent): void {
    if (!this.webcamMarkerDragging) {
      return;
    }

    event.preventDefault();
    this.scrubToClientY(event.clientY, 150);
  }

  onWebcamMarkerPointerUp(event: PointerEvent): void {
    if (!this.webcamMarkerDragging) {
      return;
    }

    this.webcamMarkerDragging = false;
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  }

  private selectWebcamDay(index: number, markerTop: number, debounceMs: number): void {
    this.webcamScrubIndex = index;
    this.webcamMarkerTop = markerTop;
    this.showWebcamImageForDay(this.webcamScrubDays[index], debounceMs);
  }

  private scrubToClientY(clientY: number, debounceMs: number): void {
    const container = this.getTimelineContainer();
    const layout = this.computeWebcamDayAnchors();
    if (!container || !layout) {
      return;
    }

    const y = clientY - container.getBoundingClientRect().top;
    const index = this.dayIndexFromTimelineY(y, layout.anchors, layout.regionStarts);

    this.cancelWebcamScrollAnimation();
    this.lastManualScrubAt = Date.now();
    if (index !== this.webcamScrubIndex || this.webcamMarkerTop === null) {
      this.selectWebcamDay(index, layout.anchors[index], debounceMs);
    }
  }

  // Keep the marker and photo in sync with the day the user scrolls to.
  private onDocumentScroll = (): void => {
    if (!this.webcamViewerOpen || this.webcamMarkerDragging || this.scrollRafPending
      || Date.now() - this.lastManualScrubAt < WEBCAM_MANUAL_SCRUB_HOLDOFF_MS) {
      return;
    }

    this.scrollRafPending = true;
    requestAnimationFrame(() => {
      this.scrollRafPending = false;
      this.syncWebcamToScrollPosition();
    });
  };

  private syncWebcamToScrollPosition(): void {
    const container = this.getTimelineContainer();
    const layout = this.computeWebcamDayAnchors();
    if (!container || !layout) {
      return;
    }

    // The day at roughly a third of the viewport height is "being read".
    const focusY = window.innerHeight * 0.35 - container.getBoundingClientRect().top;
    if (focusY < layout.anchors[0] || focusY > layout.anchors[layout.anchors.length - 1]) {
      return;
    }

    const index = this.dayIndexFromTimelineY(focusY, layout.anchors, layout.regionStarts);
    if (index === this.webcamScrubIndex) {
      return;
    }

    this.animateWebcamTowardsIndex(index, layout.anchors);
  }

  private cancelWebcamScrollAnimation(): void {
    if (this.webcamStepTimer !== undefined) {
      clearTimeout(this.webcamStepTimer);
      this.webcamStepTimer = undefined;
    }
  }

  // A scroll step can move the focus across a whole gap at once; instead of
  // teleporting, the marker ticks through the days in between at a humanly
  // visible pace, no matter how often the scroll retargets it. Large
  // distances take bigger steps so it still catches up.
  private animateWebcamTowardsIndex(targetIndex: number, anchors: number[]): void {
    this.cancelWebcamScrollAnimation();

    const step = () => {
      this.webcamStepTimer = undefined;
      const remaining = targetIndex - this.webcamScrubIndex;
      if (remaining === 0) {
        return;
      }

      const wait = this.lastWebcamStepAt + WEBCAM_STEP_INTERVAL_MS - Date.now();
      if (wait > 0) {
        this.webcamStepTimer = setTimeout(step, wait);
        return;
      }

      this.lastWebcamStepAt = Date.now();
      const delta = Math.sign(remaining) * Math.max(1, Math.round(Math.abs(remaining) / 8));
      const index = this.webcamScrubIndex + delta;
      this.zone.run(() => this.selectWebcamDay(index, anchors[index], 300));
      if (index !== targetIndex) {
        this.webcamStepTimer = setTimeout(step, WEBCAM_STEP_INTERVAL_MS);
      }
    };

    step();
  }

  private getTimelineContainer(): HTMLElement | null {
    return this.elementRef.nativeElement.querySelector('.timeline');
  }

  // Vertical layout (relative to the timeline container) of every scrub day.
  // `anchors` is where the marker sits for a day; `regionStarts` is where a
  // day's region begins going down the timeline. A day with entries anchors
  // to its dot and owns everything down to the start of its gap line, so the
  // gap only starts counting below the entries; the days in between are laid
  // out along the time-scaled gap line.
  private computeWebcamDayAnchors(): { anchors: number[]; regionStarts: number[] } | null {
    const container = this.getTimelineContainer();
    if (!container || !this.webcamScrubDays.length) {
      return null;
    }

    const containerTop = container.getBoundingClientRect().top;
    const total = this.webcamScrubDays.length;
    const anchors = new Array<number>(total).fill(Number.NaN);
    const regionStarts = new Array<number>(total).fill(Number.NaN);

    this.webcamScrubDays.forEach((day, index) => {
      if (!day.hasEvents) {
        return;
      }

      const dot = container.querySelector(`.day-section[data-day-key="${CSS.escape(day.dayKey)}"] .day-dot`);
      if (!dot) {
        return;
      }

      const rect = dot.getBoundingClientRect();
      anchors[index] = rect.top - containerTop + rect.height / 2;
      regionStarts[index] = rect.top - containerTop;
    });

    const lastIndex = total - 1;
    if (Number.isNaN(anchors[lastIndex])) {
      const todayDot = container.querySelector('.day-dot-today');
      if (todayDot) {
        const rect = todayDot.getBoundingClientRect();
        anchors[lastIndex] = rect.top - containerTop + rect.height / 2;
        regionStarts[lastIndex] = rect.top - containerTop;
      }
    }

    let previous = -1;
    for (let i = 0; i <= lastIndex; i++) {
      if (Number.isNaN(anchors[i])) {
        continue;
      }

      if (previous < 0) {
        anchors.fill(anchors[i], 0, i);
        regionStarts.fill(regionStarts[i], 0, i);
      } else {
        this.fillAnchorsBetween(anchors, regionStarts, container, containerTop, previous, i);
      }
      previous = i;
    }

    if (previous < 0) {
      return null;
    }
    anchors.fill(anchors[previous], previous + 1);
    regionStarts.fill(regionStarts[previous], previous + 1);

    return { anchors, regionStarts };
  }

  private fillAnchorsBetween(anchors: number[], regionStarts: number[], container: HTMLElement, containerTop: number, from: number, to: number): void {
    const inBetween = to - from - 1;
    const fromDay = this.webcamScrubDays[from];
    const gapLine = fromDay.hasEvents
      ? container.querySelector(`.day-section[data-day-key="${CSS.escape(fromDay.dayKey)}"] .gap-line-vertical`)
      : null;

    if (gapLine) {
      const rect = gapLine.getBoundingClientRect();
      const top = rect.top - containerTop;
      const step = rect.height / Math.max(1, inBetween);
      for (let k = 1; k <= inBetween; k++) {
        regionStarts[from + k] = top + (k - 1) * step;
        anchors[from + k] = top + (k - 0.5) * step;
      }
      regionStarts[to] = top + rect.height;
    } else if (inBetween > 0) {
      const step = (anchors[to] - anchors[from]) / (inBetween + 1);
      for (let k = 1; k <= inBetween; k++) {
        anchors[from + k] = anchors[from] + k * step;
        regionStarts[from + k] = anchors[from + k] - step / 2;
      }
      regionStarts[to] = anchors[to] - step / 2;
    }
  }

  private dayIndexFromTimelineY(y: number, anchors: number[], regionStarts: number[]): number {
    let index = 0;
    for (let i = 0; i < regionStarts.length; i++) {
      if (regionStarts[i] <= y) {
        index = i;
      }
    }

    // Days with entries win within the snap radius so they are easy to hit.
    let bestEntryDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < anchors.length; i++) {
      if (!this.webcamScrubDays[i].hasEvents) {
        continue;
      }

      const distance = Math.abs(anchors[i] - y);
      if (distance <= WEBCAM_ENTRY_SNAP_PX && distance < bestEntryDistance) {
        bestEntryDistance = distance;
        index = i;
      }
    }

    return index;
  }

  private scheduleWebcamMarkerUpdate(): void {
    setTimeout(() => this.updateWebcamMarkerPosition());
  }

  private updateWebcamMarkerPosition(): void {
    if (!this.webcamViewerOpen || !this.webcamImageDay) {
      this.webcamMarkerTop = null;
      return;
    }

    const layout = this.computeWebcamDayAnchors();
    const index = this.webcamScrubDays.findIndex(day => day.dayKey === this.webcamImageDay?.dayKey);
    this.webcamMarkerTop = layout && index >= 0 && Number.isFinite(layout.anchors[index]) ? layout.anchors[index] : null;
  }

  private scrollTimelineToDay(day: WebcamScrubDay): void {
    const index = this.webcamScrubDays.indexOf(day);
    const nearestEventDay = this.webcamScrubDays.slice(0, index + 1).reverse().find(scrubDay => scrubDay.hasEvents)
      ?? this.webcamScrubDays.slice(index + 1).find(scrubDay => scrubDay.hasEvents);
    if (!nearestEventDay) {
      return;
    }

    const element = this.elementRef.nativeElement.querySelector(`.day-section[data-day-key="${CSS.escape(nearestEventDay.dayKey)}"]`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  private showWebcamImageForDay(day: WebcamScrubDay | undefined, debounceMs: number): void {
    if (!day || this.webcamImageDay?.dayKey === day.dayKey) {
      return;
    }

    this.webcamImageDay = day;
    this.scheduleWebcamMarkerUpdate();
    if (this.webcamDebounceTimer) {
      clearTimeout(this.webcamDebounceTimer);
    }
    this.webcamDebounceTimer = setTimeout(() => void this.loadWebcamImage(day), debounceMs);
  }

  private async loadWebcamImage(day: WebcamScrubDay): Promise<void> {
    const requestId = ++this.webcamRequestCounter;
    // The server returns the newest image at or before the timestamp, so the
    // end of the day yields that day's last photo.
    const endOfDay = new Date(day.date);
    endOfDay.setHours(23, 59, 59, 999);

    this.webcamImageLoading = true;
    const url = await this.devices.getDeviceImageUrl(this.deviceId, 'jpeg', Math.min(endOfDay.getTime(), Date.now()));
    if (requestId !== this.webcamRequestCounter) {
      return;
    }

    this.webcamImageUrl = `${url}&width=800`;
  }

  onCycleSelected(event: any) {
    this.selectedCycleIndex = event.detail.value;
    void this.syncQueryParams();
  }

  private async syncQueryParams(): Promise<void> {
    await mergeDiaryQueryParams(this.router, this.route, {
      growCategories: serializeStringArrayQueryParam(this.selectedLogCategories, DEFAULT_GROW_CATEGORIES),
      growCycle: serializeNumberQueryParam(this.selectedCycle ? new Date(this.selectedCycle.timestampStart).getTime() : undefined),
    });
  }

}
