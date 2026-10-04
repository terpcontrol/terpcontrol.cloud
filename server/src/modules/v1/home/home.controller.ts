import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { HomeAnswer, MyGrowPage } from '@fg2/shared-types/v1';
import { homeAnswer, myGrowPage } from '@fg2/shared-types/v1-schemas';
import { AuthGuard } from '@common/auth/auth.guard';
import { Caller } from '@common/v1/access.guard';
import { AccessContext } from '@common/v1/access.types';
import { PageQuery, pageQuery, V1Query } from '@common/v1/validation';
import { V1Answer } from '../answer-shape';
import { HomeService } from './home.service';
import { MyGrowsService } from './my-grows.service';

/**
 * What the app opens on. There is no subject to guard - the answer is made of
 * whatever the caller can see, and a caller who can see nothing is answered an
 * empty home rather than refused.
 */
@ApiTags('home')
@Controller('v1/home')
export class HomeController {
  constructor(
    private readonly home: HomeService,
    private readonly myGrows: MyGrowsService,
  ) {}

  @Get()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'One card per space, with everything the home screen shows' })
  @V1Answer(homeAnswer)
  public read(@Caller() ctx: AccessContext): Promise<HomeAnswer> {
    return this.home.read(ctx);
  }

  /**
   * "My grows", which Start leads to: every grow the account can see, the
   * running ones first and then the finished ones, each with what its card
   * draws. Like the home it is made of what the caller can see, so there is
   * nothing to refuse.
   */
  @Get('grows')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Every grow the account can see, running ones first, as "My grows" draws them' })
  @V1Answer(myGrowPage)
  public grows(@Caller() ctx: AccessContext, @V1Query(pageQuery) query: PageQuery): Promise<MyGrowPage> {
    return this.myGrows.list(ctx, query);
  }
}
