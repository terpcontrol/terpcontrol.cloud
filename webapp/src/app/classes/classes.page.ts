import { Component, OnInit } from '@angular/core';
import { DeviceAdminService } from '../services/devices.service';

@Component({
  selector: 'app-classes',
  templateUrl: './classes.page.html',
  styleUrls: ['./classes.page.scss'],
})
export class ClassesPage implements OnInit {

  constructor(private device: DeviceAdminService) { }

  public classes: any;

  ngOnInit() {
    this.device.device_classes.subscribe((classes) => {
      this.classes = classes
      for (const cls of this.classes ?? []) {
        for (const fw of cls.versions ?? []) {
          if (fw?.fw) fw.fw._savedVersion = fw.fw.version;
        }
      }
    })
  }

  async rollout(cls:any, firmware_id: string, channel: 'stable' | 'beta' | 'alpha' = 'stable') {
    if(confirm("roll out " + firmware_id + " on " + cls.name + "?")) {
      await this.device.updateClass(
        cls.class_id,
        cls.name,
        cls.description,
        cls.concurrent,
        cls.maxfails,
        channel === 'stable' ? firmware_id : cls.firmware_id,
        channel === 'beta' ? firmware_id : cls.beta_firmware_id,
        channel === 'alpha' ? firmware_id : cls.alpha_firmware_id,
      );
      await this.device.fetch();
    }
  }

  async delete(fw: any) {
    if(confirm("delete firmware " + fw.firmware_id + "?")) {
      await this.device.deleteFirmware(fw.firmware_id);
      fw.deleted = true;
    }
  }

  async updateClass(cls:any) {
    await this.device.updateClass(cls.class_id, cls.name, cls.description, cls.concurrent, cls.maxfails, cls.firmware_id, cls.beta_firmware_id, cls.alpha_firmware_id)
    await this.device.fetch()
  }

  async updateFirmwareVersion(fw: any) {
    if (!fw?.firmware_id || fw.deleted) return;
    const newVersion = (fw.version ?? '').toString();
    if (newVersion === fw._savedVersion) return;
    fw._savedVersion = newVersion;
    await this.device.updateFirmwareVersion(fw.firmware_id, newVersion);
  }

}
