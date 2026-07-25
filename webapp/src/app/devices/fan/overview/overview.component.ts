import { Component, ElementRef, Input, OnInit, Renderer2, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { IonModal } from '@ionic/angular';
import { combineLatest } from 'rxjs';
import { DataService } from 'src/app/services/data.service';
import { DeviceWithParsedSettings, DeviceService } from 'src/app/services/devices.service';
import { LogTranslateService } from 'src/app/services/log-translate.service';
import { OverlayEventDetail } from '@ionic/core/components';
import TimeAgo from 'javascript-time-ago'

// English.
import en from 'javascript-time-ago/locale/en'
TimeAgo.addDefaultLocale(en)
// Create formatter (English).
const timeAgo = new TimeAgo('en-US')

@Component({
  selector: 'fan-overview',
  templateUrl: './overview.component.html',
  styleUrls: ['./overview.component.scss'],
})
export class FanOverviewComponent implements OnInit {

  public vpd:number = 0;
  @Input() device_id:string = "";
  @Input() device_name:string = "";
  @Input() cloud_settings:any = {};
  @ViewChild("nameedit", { read: ElementRef }) private nameInput: ElementRef | undefined;

  public t_l:number = NaN;
  public t_h:number = NaN;
  public r_l:number = NaN;
  public r_h:number = NaN;
  public logs:any;
  public config:any;
  public has_logs:boolean = false;
  public severity:number = 0;
  public device_online = false;
  public showDeviceLog:boolean = false;
  public editingName:boolean = false;

  // Day/night state and targets from the settings page
  public is_day:boolean = true;
  public tempTarget:number = NaN;
  public humidityTarget:number = NaN;
  public workmode:string = 'loading';

  constructor(private devices: DeviceService, public data: DataService, private route: ActivatedRoute, private renderer: Renderer2, public logTranslate: LogTranslateService) { }

  editName() {
    this.editingName = true;
    this.renderer.setStyle(this.nameInput?.nativeElement, 'display', 'block')
    this.renderer.selectRootElement(this.nameInput?.nativeElement);
    this.nameInput?.nativeElement.focus()
    //this.nameInput?.nativeElement.setFocus();
  }

  doneEdit() {
    this.editingName = false;
    this.renderer.setStyle(this.nameInput?.nativeElement, 'display', 'none')
    this.devices.setName(this.device_id, this.device_name)
  }

  async ngOnInit() {
    if(this.device_name == "" || this.device_name == undefined) {
      this.device_name = "Terp Control Fan"
    }
    combineLatest([
      this.data.measure(this.device_id, 'temperature'),
      this.data.measure(this.device_id, 'humidity')
    ]).subscribe(([temp, rh]) => {
      var es = 0.6108 * Math.exp(17.27 * temp / (rh + 237.3));
      var ea = rh / 100.0 * es;
      this.vpd = (es - ea) * 1000;
      if(isNaN(this.vpd)) {
        this.device_online = false;
      }
      else {
        this.device_online = true;
      }
    })

    // Track day/night to pick the matching setpoints
    this.data.measure(this.device_id, 'day').subscribe((day:any) => {
      const prev = this.is_day;
      this.is_day = (day ?? 1) >= 0.5;
      if(this.is_day !== prev) {
        this.updateTargets();
      }
    })

    this.logs = await this.devices.getLogs(this.device_id);

    this.config = this.normalizeConfig(await this.devices.getConfig(this.device_id));
    this.updateTargets();

    // Refresh targets immediately when settings are saved from the Settings page
    this.devices.settingsChanged.subscribe(({ device_id, settings }) => {
      if (device_id === this.device_id) {
        this.config = this.normalizeConfig(settings);
        this.updateTargets();
      }
    });

    if(this.logs.length) {
      this.has_logs = true;
    }
    else {
      this.has_logs = false;
    }
    this.severity = Math.max(...this.logs.map((o: { severity: number; }) => {return isNaN(o.severity) ? 0 : o.severity}))
  }

  private updateTargets() {
    const toNum = (v:any): number => {
      if(v === null || v === undefined) return NaN;
      const n = typeof v === 'number' ? v : parseFloat(v);
      return isNaN(n as any) ? NaN : n;
    };

    const cfg:any = this.config || {};
    const day:any = cfg?.day || {};
    const night:any = cfg?.night || {};

    // Workmode decides which targets are actually controlled:
    // 0 = fixed speed, 1 = temperature, 2 = humidity, 3 = temperature + humidity
    const mode = toNum(cfg?.mode);
    const controlsTemp = mode === 1 || mode === 3;
    const controlsHumidity = mode === 2 || mode === 3;

    const modeLabels: { [key: number]: string } = { 0: 'fixed', 1: 'temp', 2: 'hum', 3: 'temphum' };
    this.workmode = cfg?.mode === undefined || cfg?.mode === null
      ? 'loading'
      : (modeLabels[mode] ?? 'unknown');

    this.tempTarget = controlsTemp ? (this.is_day ? toNum(day.temperature) : toNum(night.temperature)) : NaN;
    this.humidityTarget = controlsHumidity ? (this.is_day ? toNum(day.humidity) : toNum(night.humidity)) : NaN;
  }

  // Normalize configuration returned by DeviceService.getConfig so we can always access
  // properties like day.temperature and night.humidity safely.
  private normalizeConfig(raw: any): any {
    if (!raw) return {};

    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return parsed?.settings || parsed;
      } catch {
        return {};
      }
    }

    if (typeof raw === 'object') {
      return raw.settings || raw;
    }

    return {};
  }

  @ViewChild(IonModal) modal!: IonModal;


  showLogs() {
    console.log(this.showDeviceLog)
    this.showDeviceLog = true;
  }

  clearLogs() {
    this.devices.clearLogs(this.device_id);
    this.logs = [];
    this.has_logs = false;
  }

  formatLogTime(time: Date) {
    return timeAgo.format(time);
  }

}
