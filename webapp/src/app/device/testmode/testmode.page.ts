import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { combineLatest, firstValueFrom } from 'rxjs';
import { DataService } from 'src/app/services/data.service';
import { DeviceWithParsedSettings, DeviceService } from 'src/app/services/devices.service';

@Component({
  selector: 'app-testmode',
  templateUrl: './testmode.page.html',
  styleUrls: ['./testmode.page.scss'],
})
export class TestmodePage implements OnInit {

  private ticker:any;

  public device_id:string = "";
  public outputs = {
    heater: 0,
    dehumidifier: 0,
    co2: 0,
    lights: 0,
    fanint: 0,
    fanext: 0,
    fanbw: 0
  }

  constructor(
    private devices: DeviceService,
    public data: DataService,
    private route: ActivatedRoute,
    private alertController: AlertController,
    private toastController: ToastController,
  ) { }

  async ngOnInit() {
    this.device_id = this.route.snapshot.paramMap.get('device_id') || "";
    console.log(this.device_id);

    this.outputs.heater = 0
    this.outputs.dehumidifier = 0
    this.outputs.co2 = 0
    this.outputs.lights = 0

    this.ticker = setInterval(() => {
      this.setOutputs()
    }, 5000)
    this.setOutputs()
  }

  setOutputs() {
    this.outputs.heater = parseInt('' + this.outputs.heater);
    this.outputs.co2 = parseInt('' + this.outputs.co2);
    this.outputs.dehumidifier = parseInt('' + this.outputs.dehumidifier);
    this.outputs.lights = parseInt('' + this.outputs.lights);
    this.outputs.fanint = parseInt('' + this.outputs.fanint);
    this.outputs.fanext = parseInt('' + this.outputs.fanext);
    this.outputs.fanbw = parseInt('' + this.outputs.fanbw);

    this.devices.testOutputs(this.device_id, this.outputs);
  }

  async reboot() {
    const alert = await this.alertController.create({
      header: 'Reboot device',
      message: 'The device will restart and briefly go offline. Continue?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Reboot',
          handler: async () => {
            try {
              await this.devices.rebootDevice(this.device_id);
              const toast = await this.toastController.create({ message: 'Reboot command sent', duration: 5000 });
              await toast.present();
            } catch (e: any) {
              const toast = await this.toastController.create({ message: 'Failed to reboot device: ' + e.message, duration: 5000 });
              await toast.present();
            }
          }
        }
      ]
    });
    await alert.present();
  }

  ionViewDidLeave() {
    clearInterval(this.ticker)
    this.devices.stopTest(this.device_id)
  }
}
