import { Component, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { AlertController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { DeviceService } from 'src/app/services/devices.service';
import { parseSocketRoles, socketIpFromCsv, SOCKET_ROLES } from 'src/app/util/socket-info';

const DEVICE_ONLINE_TIMEOUT_MS = 10 * 60 * 1000;
const SOCKET_CONFIRM_POLLS = 3;
const SOCKET_CONFIRM_POLL_MS = 5000;
const SOCKET_TEST_RESET_MS = 6000;

/**
 * Smart sockets the device manages: connected roles from the hardware
 * report, cloud-side edit/test/remove and the add flow (Terp sockets pair on
 * the device, manual entry is an explicit skip). Commands go to the device
 * immediately; the device confirms by re-reporting its socket csv.
 */
@Component({
  selector: 'smart-sockets',
  templateUrl: './smart-sockets.component.html',
  styleUrls: ['./smart-sockets.component.scss'],
})
export class SmartSocketsComponent implements OnChanges, OnDestroy {
  @Input() deviceId = '';
  @Input() hardwareInfo: Record<string, string> | undefined;
  @Input() lastseen: number | undefined;

  public socketRoles = [...SOCKET_ROLES];

  public editingRole: string | null = null;
  public socketDraft = { ip: '', user: '', password: '' };
  public pendingRoles = new Set<string>();
  public testedRoles = new Set<string>();

  /** Add-socket flow, mirroring the webcam add flow. */
  public addingSocket = false;
  public addSocketBrand: 'terp' | 'tasmota' | null = null;
  public addSocketRole = '';
  public terpSocketManual = false;

  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(
    private devices: DeviceService,
    private alertController: AlertController,
    private translate: TranslateService,
  ) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['hardwareInfo'] && this.pendingRoles.size > 0) {
      // The device confirms socket changes by re-reporting its csv.
      this.pendingRoles.clear();
    }
  }

  ngOnDestroy() {
    this.timers.forEach(timer => clearTimeout(timer));
  }

  get socketsReported(): boolean {
    return this.hardwareInfo?.['sockets'] !== undefined;
  }

  get deviceOffline(): boolean {
    return typeof this.lastseen === 'number' && this.lastseen > 0 && Date.now() - this.lastseen > DEVICE_ONLINE_TIMEOUT_MS;
  }

  socketState(role: string): 'connected' | 'not_connected' | 'unknown' {
    const csv = this.hardwareInfo?.['sockets'];
    if (csv === undefined) {
      return 'unknown';
    }
    return parseSocketRoles(csv).includes(role) ? 'connected' : 'not_connected';
  }

  /** Address the device reported for a role ("role@ip" pairs). */
  socketIp(role: string): string | null {
    return socketIpFromCsv(this.hardwareInfo?.['socket_ips'], role);
  }

  get freeSocketRoles(): string[] {
    return this.socketRoles.filter(role => this.socketState(role) !== 'connected');
  }

  startAddSocket() {
    this.addingSocket = true;
    this.addSocketBrand = null;
    this.addSocketRole = this.freeSocketRoles[0] ?? '';
    this.socketDraft = { ip: '', user: '', password: '' };
    this.editingRole = null;
    this.terpSocketManual = false;
  }

  pickSocketBrand(brand: 'terp' | 'tasmota') {
    this.addSocketBrand = brand;
    this.terpSocketManual = false;
  }

  cancelAddSocket() {
    this.addingSocket = false;
    this.addSocketBrand = null;
    this.terpSocketManual = false;
  }

  /** Terp sockets normally pair on the device; the form is the manual skip. */
  get socketFormVisible(): boolean {
    return this.addSocketBrand === 'tasmota' || (this.addSocketBrand === 'terp' && this.terpSocketManual);
  }

  async applyAddSocket() {
    if (!this.addSocketRole || !this.socketDraftValid) {
      return;
    }
    try {
      await this.devices.sendAuxCommand(this.deviceId, 'socket_set', this.addSocketRole, {
        ip: this.socketDraft.ip.trim(),
        user: this.socketDraft.user.trim(),
        password: this.socketDraft.password.trim(),
      });
      this.markPending(this.addSocketRole);
      this.addingSocket = false;
      this.addSocketBrand = null;
    } catch (e) {
      console.log('Socket add failed:', e);
    }
  }

  startEditSocket(role: string) {
    if (this.editingRole === role) {
      this.editingRole = null;
      return;
    }
    this.editingRole = role;
    this.addingSocket = false;
    // Prefill the reported address; credentials are write-only (empty = keep).
    this.socketDraft = { ip: this.socketIp(role) ?? '', user: '', password: '' };
  }

  get socketDraftValid(): boolean {
    const ip = this.socketDraft.ip.trim();
    return ip.length > 0 && ip.length <= 64 && /^[a-zA-Z0-9._-]+$/.test(ip);
  }

  async applySocketDraft(role: string) {
    if (!this.socketDraftValid) {
      return;
    }
    try {
      await this.devices.sendAuxCommand(this.deviceId, 'socket_set', role, {
        ip: this.socketDraft.ip.trim(),
        user: this.socketDraft.user.trim(),
        password: this.socketDraft.password.trim(),
      });
      this.editingRole = null;
      this.markPending(role);
    } catch (e) {
      console.log('Socket set failed:', e);
    }
  }

  async testSocket(role: string) {
    try {
      await this.devices.sendAuxCommand(this.deviceId, 'socket_test', role);
      this.testedRoles.add(role);
      this.timers.push(setTimeout(() => this.testedRoles.delete(role), SOCKET_TEST_RESET_MS));
    } catch (e) {
      console.log('Socket test failed:', e);
    }
  }

  async removeSocket(role: string) {
    const alert = await this.alertController.create({
      header: this.translate.instant('auxDevices.sockets.removeConfirmTitle'),
      message: this.translate.instant('auxDevices.sockets.removeConfirmText', {
        role: this.translate.instant('auxDevices.sockets.roles.' + role),
      }),
      buttons: [
        { text: this.translate.instant('misc.cancel'), role: 'cancel' },
        { text: this.translate.instant('auxDevices.sockets.remove'), role: 'destructive' },
      ],
    });
    await alert.present();
    const { role: result } = await alert.onDidDismiss();
    if (result !== 'destructive') {
      return;
    }

    try {
      await this.devices.sendAuxCommand(this.deviceId, 'socket_remove', role);
      this.markPending(role);
    } catch (e) {
      console.log('Socket removal failed:', e);
    }
  }

  trackByRole(_index: number, role: string): string {
    return role;
  }

  private markPending(role: string) {
    this.pendingRoles.add(role);
    // The device re-reports its sockets; poll a few refetches to pick it up.
    for (let i = 1; i <= SOCKET_CONFIRM_POLLS; i++) {
      this.timers.push(setTimeout(() => void this.devices.refetchDevices(), i * SOCKET_CONFIRM_POLL_MS));
    }
  }
}
