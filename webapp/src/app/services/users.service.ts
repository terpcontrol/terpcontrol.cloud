import { Injectable } from '@angular/core';
import type { UserAccount } from '@fg2/shared-types';
import { ApiClient } from '../api/api.client';
import { api } from '../api/api.routes';

export interface CreateUser {
  username: string;
  password: string;
  is_admin: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class UsersService {

  constructor(private client: ApiClient) { }

  // The listing is a projection without the demo flag: only a session has one.
  public async getAll() : Promise<UserAccount[]> {
    return await this.client.fetch(api.users.list());
  }

  public async create(user: CreateUser) {
    return await this.client.fetch(api.users.create(user));
  }
}
