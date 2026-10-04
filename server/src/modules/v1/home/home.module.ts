import { Module } from '@nestjs/common';
import { V1CommonModule } from '@common/v1/v1.module';
import { ModelsModule } from '@database/models.module';
import { DataModule } from '@modules/data/data.module';
import { GrowModule } from '../grow/grow.module';
import { SpaceModule } from '../space/space.module';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';
import { MyGrowsService } from './my-grows.service';

/**
 * The home screen's read models - Start, and the list of every grow Start leads
 * to. They read every collection a card draws from and write none of them,
 * which is why they are a module of their own rather than routes on spaces: a
 * space knows what stands in it, not what is due there.
 */
@Module({
  imports: [ModelsModule, V1CommonModule, DataModule, SpaceModule, GrowModule],
  controllers: [HomeController],
  providers: [HomeService, MyGrowsService],
})
export class HomeModule {}
