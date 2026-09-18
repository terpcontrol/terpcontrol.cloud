import { Module } from '@nestjs/common';
import { V1CommonModule } from '@common/v1/v1.module';
import { ModelsModule } from '@database/models.module';
import { DataModule } from '@modules/data/data.module';
import { SpaceModule } from '../space/space.module';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';

/**
 * The home screen's read model. It reads every collection a card draws from
 * and writes none of them, which is why it is a module of its own rather than
 * a route on spaces: a space knows what stands in it, not what is due there.
 */
@Module({
  imports: [ModelsModule, V1CommonModule, DataModule, SpaceModule],
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}
