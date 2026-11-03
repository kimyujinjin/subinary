import { Module } from '@nestjs/common';
import { FinanceConnectionsController } from './finance-connections.controller';
import { FinanceConnectionsService } from './finance-connections.service';
import { FinanceVault } from './finance-vault';
import { TossProviderClient } from './toss-provider';

@Module({ controllers: [FinanceConnectionsController], providers: [FinanceConnectionsService, FinanceVault,
  { provide: TossProviderClient, useFactory: () => new TossProviderClient() }] })
export class FinanceConnectionsModule {}
