import { Module } from '@nestjs/common';
import { FinanceConnectionsController } from './finance-connections.controller';
import { FinanceConnectionsService } from './finance-connections.service';
import { FinanceVault } from './finance-vault';
import { TossProviderClient } from './toss-provider';
import { BankConnectionsController } from '../bank-connections/bank-connections.controller';
import { BankConnectionsService } from '../bank-connections/bank-connections.service';
import { BankBrowserClient } from '../bank-connections/bank-browser';

@Module({ controllers: [FinanceConnectionsController, BankConnectionsController], providers: [FinanceConnectionsService, FinanceVault, BankConnectionsService, BankBrowserClient,
  { provide: TossProviderClient, useFactory: () => new TossProviderClient() }] })
export class FinanceConnectionsModule {}
