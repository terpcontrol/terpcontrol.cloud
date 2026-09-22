import { Module } from '@nestjs/common';
import { V1CommonModule } from '@common/v1/v1.module';
import { ModelsModule } from '@database/models.module';
import { SchemesController } from './schemes.controller';
import { SchemesService } from './schemes.service';

/**
 * A grower's own feeding schemes.
 *
 * A slice of its own and not part of the grow module, because it shares nothing
 * with one: a grow carries its own copy of the grid and never reads a row here,
 * which is exactly what keeps a run already under way from changing when its
 * scheme is edited.
 */
@Module({
  imports: [ModelsModule, V1CommonModule],
  controllers: [SchemesController],
  providers: [SchemesService],
})
export class SchemeModule {}
