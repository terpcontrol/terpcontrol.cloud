import { Injectable } from '@angular/core';
import type { RecipeTemplate } from '@fg2/shared-types';
import { ApiClient } from '../api/api.client';
import { api } from '../api/api.routes';

@Injectable({
  providedIn: 'root'
})
export class RecipeService {
  constructor(private client: ApiClient) {}

  public async listTemplates(): Promise<RecipeTemplate[]> {
    return await this.client.fetch(api.recipeTemplates.list());
  }

  public async getTemplate(id: string): Promise<RecipeTemplate> {
    return await this.client.fetch(api.recipeTemplates.read(id));
  }

  public async createTemplate(name: string, steps: RecipeTemplate['steps'], isPublic: boolean) {
    return await this.client.fetch(api.recipeTemplates.create(name, steps, isPublic));
  }

  public async deleteTemplate(id: string) {
    return await this.client.fetch(api.recipeTemplates.remove(id));
  }
}
