import { Module } from '@nestjs/common';
import { V1CommonModule } from '@common/v1/v1.module';
import { ModelsModule } from '@database/models.module';
import { MailModule } from '@modules/mail/mail.module';
import { PhaseModule } from '../phase/phase.module';
import { PlanEngineService } from './plan-engine.service';
import { PlanProgressService } from './plan-progress.service';
import { PlanService } from './plan.service';

/**
 * The grow plans: the loop that walks them and the moves a person makes in one.
 *
 * `DEVICE_CONFIGURATION_WRITER` is bound where the device protocol is spoken and
 * is the one thing this module expects from outside - the plan decides what a
 * device should be running, never how it is told.
 */
@Module({
  imports: [ModelsModule, V1CommonModule, MailModule, PhaseModule],
  providers: [PlanEngineService, PlanProgressService, PlanService],
  exports: [PlanService, PlanProgressService],
})
export class PlanModule {}
