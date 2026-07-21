import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { combineLatest } from 'rxjs';
import { DataService } from 'src/app/services/data.service';
import { DeviceWithParsedSettings, DeviceService } from 'src/app/services/devices.service';



@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
})
export class SettingsPage implements OnInit {
  public device_id:string = "";
  public device_type:string = ""
  public hardwareInfo: Record<string, string> | undefined;
  public lastseen: number | undefined;

  constructor(
    private devices: DeviceService,
    public data: DataService,
    private route: ActivatedRoute,
    private translate: TranslateService
  ) {

  }

  async ngOnInit() {
    this.device_id = this.route.snapshot.paramMap.get('device_id') || "";
    this.devices.devices.subscribe((devices) => {
      const device = devices.find((device) => device.device_id == this.device_id);
      this.device_type = device?.device_type || '';
      this.hardwareInfo = device?.hardwareInfo;
      this.lastseen = device?.lastseen;
    })
  }
}
