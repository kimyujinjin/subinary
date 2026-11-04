import { Module } from '@nestjs/common';

import { ConnectedAccountsController } from './connected-accounts.controller';
import { ConnectedAccountsService } from './connected-accounts.service';

/** 연결 계좌 가족 합산과 공유 동의. */
@Module({ controllers: [ConnectedAccountsController], providers: [ConnectedAccountsService] })
export class ConnectedAccountsModule {}
