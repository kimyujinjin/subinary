import { Body, Controller, Get, Header, HttpCode, Post, Query } from '@nestjs/common';
import type { ConnectedAccountsResponse } from '@family/contracts';

import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { ConnectedAccountsService } from './connected-accounts.service';

/** 전역 access-token 가드가 적용된다. */
@Controller('connected-accounts')
export class ConnectedAccountsController {
  constructor(private readonly service: ConnectedAccountsService) {}

  @Get() @Header('Cache-Control', 'no-store, private')
  list(@CurrentUser() user: AuthenticatedUser, @Query('householdId') householdId: string): Promise<ConnectedAccountsResponse> {
    return this.service.list(user.userId, householdId);
  }

  @Post('sharing') @HttpCode(200) @Header('Cache-Control', 'no-store, private')
  setSharing(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown): Promise<ConnectedAccountsResponse> {
    return this.service.setSharing(user.userId, input);
  }
}
