import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Scheme, SchemeCreate, SchemePage, SchemeUpdate } from '@fg2/shared-types/v1';
import { scheme as schemeShape, schemeCreate, schemePage, schemeUpdate } from '@fg2/shared-types/v1-schemas';
import { AuthGuard } from '@common/auth/auth.guard';
import { Caller } from '@common/v1/access.guard';
import { AccessContext } from '@common/v1/access.types';
import { pageLimit } from '@common/v1/pages';
import { V1Query, pageQuery } from '@common/v1/validation';
import { V1Body } from '@common/zod-validation.pipe';
import { V1Answer } from '../answer-shape';
import { SchemesService } from './schemes.service';

/**
 * The feeding schemes somebody keeps of their own.
 *
 * None of these routes declares a need with the guard: a scheme stands in
 * nobody's space and belongs to no grow, so there is no subject for `access()`
 * to decide about. Whose it is, is the whole of it, and the service says so
 * where it reads that.
 */
@ApiTags('grows')
@Controller('v1/schemes')
@UseGuards(AuthGuard)
export class SchemesController {
  constructor(private readonly schemes: SchemesService) {}

  @Get()
  @ApiOperation({ summary: 'The feeding schemes this account has saved, newest first' })
  @V1Answer(schemePage)
  public list(@Caller() ctx: AccessContext, @V1Query(pageQuery) query: z.infer<typeof pageQuery>): Promise<SchemePage> {
    return this.schemes.list(ctx, query, pageLimit(query.limit));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Keep a feeding scheme to start grows from' })
  @V1Answer(schemeShape, { status: HttpStatus.CREATED })
  public create(@Caller() ctx: AccessContext, @V1Body(schemeCreate) body: SchemeCreate): Promise<Scheme> {
    return this.schemes.create(ctx, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a scheme or change its grid' })
  @V1Answer(schemeShape, { description: 'The scheme as the edit left it. No grow is rewritten: each carries its own copy of the grid.' })
  public update(@Caller() ctx: AccessContext, @Param('id') id: string, @V1Body(schemeUpdate) body: SchemeUpdate): Promise<Scheme> {
    return this.schemes.update(ctx, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Throw a scheme away' })
  @ApiNoContentResponse({ description: 'The scheme is gone; a grow started from it keeps its own grid and goes on being fed the same way.' })
  public remove(@Caller() ctx: AccessContext, @Param('id') id: string): Promise<void> {
    return this.schemes.remove(ctx, id);
  }
}
