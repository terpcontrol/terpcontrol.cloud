import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthContext } from '../../common/auth/token.service';
import { zodBodyAsError } from '../../common/zod-validation.pipe';
import { ChartPresetService } from './chart-preset.service';
import { CreateChartPreset, createChartPresetSchema } from './chart-preset.schemas';

@ApiTags('chart presets')
@Controller('chartpresets')
@UseGuards(AuthGuard)
export class ChartPresetController {
  constructor(private readonly presets: ChartPresetService) {}

  @Get()
  @ApiOperation({ summary: 'The saved chart views of the calling user, newest first' })
  public list(@CurrentUser() user: AuthContext) {
    return this.presets.list(user.userId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Save a chart view' })
  public create(@CurrentUser() user: AuthContext, @Body(zodBodyAsError(createChartPresetSchema)) body: CreateChartPreset) {
    return this.presets.create(user.userId, body);
  }

  @Delete(':preset_id')
  @ApiOperation({ summary: 'Delete a saved chart view' })
  public async remove(@CurrentUser() user: AuthContext, @Param('preset_id') presetId: string) {
    await this.presets.remove(user.userId, presetId);
    return { status: 'ok' };
  }
}
