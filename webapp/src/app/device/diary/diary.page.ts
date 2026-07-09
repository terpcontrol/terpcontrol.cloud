import {Component, OnDestroy, OnInit, ViewChild} from '@angular/core';
import 'chartjs-adapter-luxon';
import {ActivatedRoute, Router} from '@angular/router';
import { Subscription } from 'rxjs';
import {DeviceService} from 'src/app/services/devices.service';
import { ModalController } from '@ionic/angular';
import {DiaryEntryModalComponent, defaultDiaryEntries} from './diary-entry-modal/diary-entry-modal.component';
import {OverlayEventDetail} from "@ionic/core/components";
import type { DiaryEntry, ShareAccess } from '@fg2/shared-types';
import { DEFAULT_DIARY_REPORT, DiaryReport, mergeDiaryQueryParams, parseDiaryReport } from './diary-query-params';
import { ShareLinkModalComponent } from '../../components/share-link/share-link-modal.component';
import { ThemeService } from '../../services/theme.service';
import { GrowReportComponent } from './grow-report/grow-report.component';

@Component({
  selector: 'app-diary',
  templateUrl: './diary.page.html',
  styleUrls: ['./diary.page.scss'],
})
export class DiaryPage implements OnInit, OnDestroy {
  public deviceId: string = '';
  public cloudSettings: any = {};
  public lastUpdated: number | undefined;
  public isPublic = false;
  public canEdit = true;
  public share?: ShareAccess;
  // A view-only share link: the visitor sees the shared view but cannot change it.
  public locked = false;
  // Set when locked: the view stored with the link, overriding URL parameters.
  public lockedParams?: URLSearchParams;
  public webcamAllowed = true;
  public chartsAllowed = true;
  public resolved = false;

  public selectedReport: DiaryReport = 'entries';

  @ViewChild(GrowReportComponent) private growReport?: GrowReportComponent;

  private queryParamsSubscription?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private devices: DeviceService,
    private modalController: ModalController,
    public theme: ThemeService
  ) {
  }

  ngOnInit(): void {
    this.deviceId = this.route.snapshot.paramMap.get('device_id') || '';

    this.queryParamsSubscription = this.route.queryParamMap.subscribe(params => {
      this.selectedReport = parseDiaryReport((this.lockedParams ?? params).get('report'));
    });

    void this.devices.resolveDeviceAccessInfo(this.deviceId)
      .then(deviceAccessInfo => {
        this.isPublic = deviceAccessInfo.isPublic;
        this.canEdit = !deviceAccessInfo.isPublic;
        this.share = deviceAccessInfo.share;
        this.locked = !!this.share && !this.share.editable;
        this.webcamAllowed = !deviceAccessInfo.isPublic || !!this.share?.webcam;
        this.chartsAllowed = !deviceAccessInfo.isPublic || !!this.share?.charts;
        this.cloudSettings = deviceAccessInfo.cloudSettings || {};

        if (this.locked) {
          this.lockedParams = new URLSearchParams(this.share?.query ?? '');
          this.selectedReport = parseDiaryReport(this.lockedParams.get('report'));
        }
        this.resolved = true;
      })
      .catch(() => {
        this.isPublic = false;
        this.canEdit = false;
        this.cloudSettings = {};
        this.resolved = true;
      });
  }

  ngOnDestroy(): void {
    this.queryParamsSubscription?.unsubscribe();
  }

  async openEntryModal() {
    if (!this.canEdit) {
      return;
    }

    const modal = await this.modalController.create({
      component: DiaryEntryModalComponent,
      backdropDismiss: false,
      componentProps: {
        deviceId: this.deviceId,
      },
    });

    await modal.present();
    const result: OverlayEventDetail<DiaryEntry> = await modal.onDidDismiss();

    if (result.role === 'save') {
      const data = {
        title: result.data?.title ?? '',
        message: result.data?.message ?? result.data?.title ?? '',
        time: result.data?.time,
        raw: !(result.data?.category && result.data.category in defaultDiaryEntries),
        categories: ['diary', result.data?.category || 'unknown'],
        data: result.data?.data,
        images: result.data?.images,
        severity: 0,
        deleted: true,
      };
      await this.devices.addLog(this.deviceId, data);
      this.lastUpdated = Date.now();
    }

  }

  reportSelected() {
    void mergeDiaryQueryParams(this.router, this.route, {
      report: this.selectedReport === DEFAULT_DIARY_REPORT ? null : this.selectedReport,
    });
  }

  async openShareModal() {
    const modal = await this.modalController.create({
      component: ShareLinkModalComponent,
      componentProps: {
        deviceId: this.deviceId,
        page: 'diary',
        // The component state, not the URL parameter: the viewer can be opened
        // in ways that only sync the URL asynchronously (or not at all).
        webcamActive: !!this.growReport?.webcamViewerOpen,
      },
    });
    await modal.present();
  }
}
