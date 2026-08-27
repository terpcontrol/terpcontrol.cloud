import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Recipe } from '@fg2/shared-types';
import { demoRecipe } from '@utils/demo';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { DeviceIdFrom, DeviceOwnerGuard } from '../../common/auth/device-access.guard';
import { AuthContext } from '../../common/auth/token.service';
import { DeviceRecipeService, RecipePayload, RecipeTemplatePayload } from './device-recipe.service';

@ApiTags('grow plans')
@Controller('device')
export class DeviceRecipeController {
  constructor(private readonly recipes: DeviceRecipeService) {}

  @Get('recipe/:device_id')
  @UseGuards(DeviceOwnerGuard)
  @ApiOperation({ summary: 'The plan a device is running' })
  public async forDevice(@CurrentUser() user: AuthContext, @Param('device_id') deviceId: string): Promise<Recipe> {
    const recipe = await this.recipes.forDevice(deviceId);
    return user.isDemo ? (demoRecipe(recipe) as Recipe) : recipe;
  }

  @Post('recipe')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DeviceOwnerGuard)
  @DeviceIdFrom('body', 'error')
  @ApiOperation({ summary: 'Store the plan a device should run' })
  public async save(@Body() body: { device_id: string; recipe?: RecipePayload }) {
    if (body?.recipe === undefined || body?.recipe === null) {
      throw new BadRequestException({ error: 'Missing recipe payload' });
    }

    await this.recipes.save(body.device_id, body.recipe);
    return { status: 'ok' };
  }

  @Get('recipes')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'The plan templates the caller may use: public ones and their own' })
  public listTemplates(@CurrentUser() user: AuthContext) {
    return this.recipes.listTemplates(user.userId);
  }

  @Post('recipes')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Save a plan as a reusable template' })
  public createTemplate(@CurrentUser() user: AuthContext, @Body() body: RecipeTemplatePayload) {
    return this.recipes.createTemplate(user.userId, body);
  }

  @Get('recipes/:template_id')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'One plan template' })
  public readTemplate(@CurrentUser() user: AuthContext, @Param('template_id') templateId: string) {
    return this.recipes.readTemplate(user, templateId);
  }

  @Put('recipes/:template_id')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Change a plan template' })
  public updateTemplate(@CurrentUser() user: AuthContext, @Param('template_id') templateId: string, @Body() body: RecipeTemplatePayload) {
    return this.recipes.updateTemplate(user, templateId, body);
  }

  @Delete('recipes/:template_id')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Delete a plan template' })
  public async deleteTemplate(@CurrentUser() user: AuthContext, @Param('template_id') templateId: string) {
    await this.recipes.deleteTemplate(user, templateId);
    return { status: 'ok' };
  }
}
