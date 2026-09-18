import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { HomeAnswer } from '@fg2/shared-types/v1';
import { homeAnswer } from '@fg2/shared-types/v1-schemas';
import { AuthGuard } from '@common/auth/auth.guard';
import { Caller } from '@common/v1/access.guard';
import { AccessContext } from '@common/v1/access.types';
import { V1Answer } from '../answer-shape';
import { HomeService } from './home.service';

/**
 * What the app opens on. There is no subject to guard - the answer is made of
 * whatever the caller can see, and a caller who can see nothing is answered an
 * empty home rather than refused.
 */
@ApiTags('home')
@Controller('v1/home')
export class HomeController {
  constructor(private readonly home: HomeService) {}

  @Get()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'One card per space, with everything the home screen shows' })
  @V1Answer(homeAnswer)
  public read(@Caller() ctx: AccessContext): Promise<HomeAnswer> {
    return this.home.read(ctx);
  }
}
