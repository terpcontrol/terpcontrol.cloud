import { Component, OnInit } from '@angular/core';
import { AlertController } from '@ionic/angular';
import { DeviceAdminService } from '../services/devices.service';

@Component({
  selector: 'app-classes',
  templateUrl: './classes.page.html',
  styleUrls: ['./classes.page.scss'],
})
export class ClassesPage implements OnInit {

  constructor(private device: DeviceAdminService, private alertController: AlertController) { }

  public classes: any;

  // When enabled, the firmware list is filtered the same way users see it when
  // picking firmware on the manual channel: only firmwares that were ever stable,
  // anything newer than the most recent stable build, plus the firmwares that are
  // currently rolled out on a channel (stable/beta/alpha) for the class.
  public filterStable = false;

  ngOnInit() {
    this.device.device_classes.subscribe((classes) => {
      this.classes = classes
    })
  }

  visibleVersions(cls: any): any[] {
    const versions: any[] = cls?.versions ?? [];
    if (!this.filterStable) {
      return versions;
    }

    const stableCutoff = versions
      .filter(v => v.fw?.wasStable)
      .reduce((max, v) => Math.max(max, v.fw?.createdAt ?? 0), -Infinity);

    const pinnedIds = new Set(
      [cls?.class?.firmware_id, cls?.class?.beta_firmware_id, cls?.class?.alpha_firmware_id].filter(Boolean),
    );

    return versions.filter(v => {
      // Always keep the synthetic "unknown" row (no firmware_id) so the count of
      // devices on unrecognised firmware stays visible.
      if (!v.fw?.firmware_id) {
        return true;
      }
      return v.fw?.wasStable || (v.fw?.createdAt ?? 0) > stableCutoff || pinnedIds.has(v.fw.firmware_id);
    });
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

  async editVersion(fw: any) {
    if (!fw?.firmware_id || fw.deleted) return;
    const alert = await this.alertController.create({
      header: 'Edit firmware version',
      subHeader: fw.firmware_id,
      inputs: [
        { name: 'version', type: 'text', value: fw.version ?? '', placeholder: 'Version' },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Save',
          handler: async (data) => {
            const next = (data?.version ?? '').toString().trim();
            if (!next || next === fw.version) return true;
            await this.device.updateFirmwareVersion(fw.firmware_id, next);
            await this.device.fetch();
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

}
