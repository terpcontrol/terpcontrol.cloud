import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from 'src/environments/environment';
import type { UserAccount } from '@fg2/shared-types';

export interface CreateUser {
  username: string;
  password: string;
  is_admin: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class UsersService {

  constructor(private http: HttpClient) { }

  public async getAll() : Promise<UserAccount[]> {
    let data = await firstValueFrom(this.http.get<UserAccount[]>(environment.API_URL + '/users'));
    console.log(data)
    return data;

  }

  public async create(user: CreateUser) {
    return firstValueFrom(this.http.post(environment.API_URL + '/users', user));
  }
}
