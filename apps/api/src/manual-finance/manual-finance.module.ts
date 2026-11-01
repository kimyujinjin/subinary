import { Module } from '@nestjs/common';
import { ManualFinanceController } from './manual-finance.controller';
import { ManualFinanceService } from './manual-finance.service';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({ imports: [RealtimeModule], controllers: [ManualFinanceController], providers: [ManualFinanceService] })
export class ManualFinanceModule {}
