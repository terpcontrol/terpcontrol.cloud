import { Component, OnInit } from '@angular/core';
import { NavController } from '@ionic/angular';
import { AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-demo',
  templateUrl: './demo.page.html',
  styleUrls: ['./demo.page.scss'],
})
export class DemoPage implements OnInit {
  constructor(private auth: AuthService, private navCtrl: NavController) {}

  public async ngOnInit() {
    try {
      await this.auth.loginAsDemo();
    } catch (error) {
      console.log(error);
      await this.navCtrl.navigateRoot('/login', { queryParams: { reason: 'demo-unavailable' } });
      return;
    }

    // navigateRoot rather than the plain Router: this page is only a stop on the way
    // into the app, so the Ionic navigation stack has to be rebuilt, not pushed onto.
    await this.navCtrl.navigateRoot('/list');
  }
}
