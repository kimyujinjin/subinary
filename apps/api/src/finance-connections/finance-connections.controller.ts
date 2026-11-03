import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type { FinanceConnectionDisconnect, FinanceConnectionRefresh, FinanceConnectionRegister, FinanceConnectionSelectAccount } from '@family/contracts';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { FinanceConnectionsService } from './finance-connections.service';

/** Global access-token guard applies. Service parsing uses generic, non-echoing validation errors. */
@Controller('finance-connections')
export class FinanceConnectionsController {
  constructor(private readonly service: FinanceConnectionsService) {}

  @Get() @Header('Cache-Control', 'no-store, private')
  list(@CurrentUser() user: AuthenticatedUser, @Query('householdId') householdId: string) {
    return this.service.list(user.userId, householdId);
  }

  @Post('toss') @HttpCode(200) @Header('Cache-Control', 'no-store, private')
  register(@CurrentUser() user: AuthenticatedUser, @Body() input: FinanceConnectionRegister) {
    return this.service.register(user.userId, input);
  }

  @Post(':id/account') @HttpCode(200) @Header('Cache-Control', 'no-store, private')
  selectAccount(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: FinanceConnectionSelectAccount) {
    return this.service.selectAccount(user.userId, id, input);
  }

  @Post(':id/refresh') @HttpCode(200) @Header('Cache-Control', 'no-store, private')
  refresh(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: FinanceConnectionRefresh) {
    return this.service.refresh(user.userId, id, input);
  }

  @Delete(':id') @HttpCode(200) @Header('Cache-Control', 'no-store, private')
  disconnect(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: FinanceConnectionDisconnect) {
    return this.service.disconnect(user.userId, id, input);
  }
}
