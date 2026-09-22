import { Module } from '@nestjs/common';
import { V1CommonModule } from '@common/v1/v1.module';
import { ModelsModule } from '@database/models.module';
import { DeviceProtocolModule } from '@modules/device-protocol/device-protocol.module';
import { RetentionModule } from '@modules/retention/retention.module';
import { AdminFleetController } from './admin-fleet.controller';
import { AdminStatsService } from './admin-stats.service';
import { FirmwareRolloutService } from './firmware-rollout.service';
import { FleetService } from './fleet.service';

/**
 * The builds and the classes they are handed out to, and the loop that hands
 * them out.
 *
 * It depends on the device protocol rather than the other way round: what an
 * update instruction looks like on the wire is frozen and belongs there, and
 * which device is told is decided here. The presence sink that feeds the loop is
 * bound where the modules are wired together.
 *
 * The install's own health hangs here too, because the screen it is drawn on is
 * this one. That is what the retention module is imported for: the sweep runs
 * on its own and answers one question, what its last pass did.
 */
@Module({
  imports: [ModelsModule, V1CommonModule, DeviceProtocolModule, RetentionModule],
  controllers: [AdminFleetController],
  providers: [FleetService, FirmwareRolloutService, AdminStatsService],
  exports: [FleetService, FirmwareRolloutService],
})
export class FleetModule {}
