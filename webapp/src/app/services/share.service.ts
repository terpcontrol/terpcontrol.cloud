import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from 'src/environments/environment';
import type { DeviceAccessInfo, ShareLink, SharePage } from '@fg2/shared-types';

// The share token travels in the page URL (?share=...). It is read straight from
// the browser URL so the HTTP interceptor and image URLs can pick it up without
// needing a router injection.
export function currentShareToken(): string | null {
  return new URLSearchParams(window.location.search).get('share');
}

export function isShareActive(share: ShareLink): boolean {
  return !share.revokedAt && (!share.expiresAt || share.expiresAt > Date.now());
}

@Injectable({
  providedIn: 'root'
})
export class ShareService {
  private resolved = new Map<string, Promise<DeviceAccessInfo>>();

  constructor(private http: HttpClient) {}

  // Resolving counts as one "open" on the server, so the result is cached per
  // token: the route guard and the page share a single request per page load.
  public resolve(token: string): Promise<DeviceAccessInfo> {
    let promise = this.resolved.get(token);
    if (!promise) {
      promise = firstValueFrom(
        this.http.get<DeviceAccessInfo>(environment.API_URL + '/share/resolve/' + token, { headers: { Authorization: '' } })
      );
      promise.catch(() => this.resolved.delete(token));
      this.resolved.set(token, promise);
    }
    return promise;
  }

  public async create(options: {
    device_id: string;
    page: SharePage;
    editable: boolean;
    webcam: boolean;
    valid_days: number | null;
    query?: string;
  }): Promise<ShareLink> {
    return await firstValueFrom(this.http.post<ShareLink>(environment.API_URL + '/share', options));
  }

  // The full URL a share link points at, reproducing the shared view.
  public linkFor(share: ShareLink): string {
    const params = new URLSearchParams(share.query ?? '');
    params.set('share', share.share_id);
    return `${window.location.origin}/device/${share.device_id}/${share.page}?${params.toString()}`;
  }

  public async list(): Promise<ShareLink[]> {
    return await firstValueFrom(this.http.get<ShareLink[]>(environment.API_URL + '/share'));
  }

  public async revoke(share_id: string): Promise<ShareLink> {
    return await firstValueFrom(this.http.post<ShareLink>(environment.API_URL + '/share/' + share_id + '/revoke', {}));
  }

  public async remove(share_id: string): Promise<void> {
    await firstValueFrom(this.http.delete(environment.API_URL + '/share/' + share_id));
  }

  public async removeInactive(): Promise<void> {
    await firstValueFrom(this.http.delete(environment.API_URL + '/share/inactive'));
  }
}
