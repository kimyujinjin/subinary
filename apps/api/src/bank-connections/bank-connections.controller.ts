import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type { BankConnectionDisconnect, BankConnectionRefresh, BankConnectionRegister } from '@family/contracts';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { BankConnectionsService } from './bank-connections.service';

/** Existing global JWT guard applies; service validation never echoes a password/body. */
@Controller('bank-connections')
export class BankConnectionsController {
  constructor(private readonly service: BankConnectionsService) {}
  @Get('catalog') @Header('Cache-Control', 'no-store, private')
  catalog(@CurrentUser() user: AuthenticatedUser, @Query('householdId') householdId: string) {
    return this.service.catalog(user.userId, householdId);
  }
  @Get() @Header('Cache-Control', 'no-store, private')
  list(@CurrentUser() user: AuthenticatedUser, @Query('householdId') householdId: string) {
    return this.service.list(user.userId, householdId);
  }
  @Post('shinhan') @HttpCode(200) @Header('Cache-Control', 'no-store, private')
  async register(@CurrentUser() user: AuthenticatedUser, @Body() input: BankConnectionRegister) {
    try { return await this.service.register(user.userId, input); }
    finally {
      if (input && typeof input === 'object') { input.loginId = ''; input.password = ''; }
    }
  }
  @Post(':id/refresh') @HttpCode(200) @Header('Cache-Control', 'no-store, private')
  refresh(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() input: BankConnectionRefresh) {
    return this.service.refresh(user.userId, id, input);
  }
  @Delete(':id') @HttpCode(200) @Header('Cache-Control', 'no-store, private')
  disconnect(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() input: BankConnectionDisconnect) {
    return this.service.disconnect(user.userId, id, input);
  }
}
