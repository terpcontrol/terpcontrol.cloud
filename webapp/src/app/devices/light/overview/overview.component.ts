import { Component, ElementRef, Input, OnInit, Renderer2, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { IonModal } from '@ionic/angular';
import { combineLatest } from 'rxjs';
import { DataService } from 'src/app/services/data.service';
import { DeviceWithParsedSettings, DeviceService } from 'src/app/services/devices.service';
import { LogTranslateService } from 'src/app/services/log-translate.service';
import { OverlayEventDetail } from '@ionic/core/components';
import {formatTimeAgo} from 'src/app/util/time-ago';
@Component({
  selector: 'light-overview',
  templateUrl: './overview.component.html',
  styleUrls: ['./overview.component.scss'],
})
export class LightOverviewComponent implements OnInit {

  public vpd:number = 0;
  @Input() device_id:string = "";
  @Input() device_name:string = "";
  @Input() cloud_settings:any = {};
  @ViewChild("nameedit", { read: ElementRef }) private nameInput: ElementRef | undefined;

  public logs:any;
  public config:any;
  public has_logs:boolean = false;
  public severity:number = 0;
  public device_online = false;
  public showDeviceLog:boolean = false;
  public editingName:boolean = false;

  // Temperature limit from the settings page
  public maxTemperature:number = NaN;

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
      this.device_name = "Terp Control Light"
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

    this.logs = await this.devices.getLogs(this.device_id);

    this.config = this.normalizeConfig(await this.devices.getConfig(this.device_id));
    this.updateTargets();

    // Refresh the limit immediately when settings are saved from the Settings page
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
    const cfg:any = this.config || {};
    const v = cfg?.max_temperature;
    const n = v === null || v === undefined ? NaN : (typeof v === 'number' ? v : parseFloat(v));
    this.maxTemperature = isNaN(n as any) ? NaN : n;
  }

  // Normalize configuration returned by DeviceService.getConfig so we can always
  // access properties like max_temperature safely.
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
    return formatTimeAgo(time);
  }

}
