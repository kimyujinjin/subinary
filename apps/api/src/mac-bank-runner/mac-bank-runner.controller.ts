import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { MacBankRunnerService } from './mac-bank-runner.service';

/** JWT 승인자와 제한된 실행기 bearer를 구분한다. 입력·인증정보를 응답하지 않는다. */
@Controller('mac-bank-runner')
export class MacBankRunnerController {
  constructor(private readonly service: MacBankRunnerService) {}
  private bearer(request: FastifyRequest): string {
    const match = /^Bearer ([0-9a-f]{64})$/.exec(String(request.headers.authorization ?? ''));
    if (!match) throw new UnauthorizedException('Mac 연결 인증을 확인해 주세요.');
    return match[1];
  }
  private erase(input: unknown, keys: readonly string[]): void {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      const value = input as Record<string, unknown>;
      for (const key of keys) if (key in value) value[key] = '';
    }
  }
  /** 공개 요청은 페어링 대기 행만 생성한다. */
  @Public() @Post('pair') @HttpCode(200) @Header('Cache-Control', 'no-store, private')
  async pair(@Body() input: unknown) {
    try { return await this.service.pair(input); } finally { this.erase(input, ['secret', 'userCode']); }
  }
  /** 기존 모아 JWT 사용자가 본인 Mac을 승인한다. */
  @Post('approve') @HttpCode(200) @Header('Cache-Control', 'no-store, private')
  async approve(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown) {
    try { return await this.service.approve(user.userId, input); } finally { this.erase(input, ['userCode']); }
  }
  /** 실행기 secret은 이 API 전용이며 ChatGPT 로그인 토큰이 아니다. */
  @Public() @Post('heartbeat') @HttpCode(200) @Header('Cache-Control', 'no-store, private')
  heartbeat(@Req() request: FastifyRequest) { return this.service.heartbeat(this.bearer(request)); }
  /** 본인 가구의 실행기·최신 작업·이전 성공만 조회한다. */
  @Get('state') @Header('Cache-Control', 'no-store, private')
  state(@CurrentUser() user: AuthenticatedUser, @Query('householdId') householdId: string) { return this.service.state(user.userId, { householdId }); }
  /** 표시한 동의 문구에 대한 사용자 클릭으로 한 작업만 생성한다. */
  @Post('jobs') @HttpCode(200) @Header('Cache-Control', 'no-store, private')
  async jobs(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown) { return (await this.service.enqueue(user.userId, input)).job; }
  /** HTTPS로 나가는 Mac 연결만 작업을 claim한다. */
  @Public() @Post('claim') @HttpCode(200) @Header('Cache-Control', 'no-store, private')
  claim(@Req() request: FastifyRequest, @Body() input: unknown) { return this.service.claim(this.bearer(request), input); }
  /** 기존 비공개 API 프록시의 HTTPS 경계에서 본인 Mac용 로그인 정보를 암호화 저장한다. */
  @Post('credentials') @HttpCode(200) @Header('Cache-Control', 'no-store, private') @Header('Pragma', 'no-cache')
  async saveCredentials(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown, @Req() request: FastifyRequest) {
    try { return await this.service.saveCredentials(user.userId, input); }
    finally {
      this.erase(input, ['loginId', 'password']);
      const raw = (request as FastifyRequest & { rawBody?: unknown }).rawBody;
      if (Buffer.isBuffer(raw)) raw.fill(0);
    }
  }
  /** 저장한 암호문을 본인만 삭제하며 낡은 화면의 버전은 거부한다. */
  @Delete('credentials') @HttpCode(200) @Header('Cache-Control', 'no-store, private') @Header('Pragma', 'no-cache')
  deleteCredentials(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown) { return this.service.deleteCredentials(user.userId, input); }
  /** 고정 HTTPS를 사용하는 실행기의 최초 claim 전달이다. 일반 상태 응답에는 평문을 넣지 않는다. */
  @Public() @Post('jobs/:id/credentials') @HttpCode(200) @Header('Cache-Control', 'no-store, private') @Header('Pragma', 'no-cache')
  retrieveCredentials(@Req() request: FastifyRequest, @Param('id', new ParseUUIDPipe()) id: string, @Body() input: unknown) {
    return this.service.retrieveCredentials(this.bearer(request), id, input);
  }
  /** 실행 중 공개 단계명만 갱신한다. */
  @Public() @Post('jobs/:id/progress') @HttpCode(200) @Header('Cache-Control', 'no-store, private')
  progress(@Req() request: FastifyRequest, @Param('id', new ParseUUIDPipe()) id: string, @Body() input: unknown) { return this.service.progress(this.bearer(request), id, input); }
  /** 정상 은행 인증을 마친 본인 앱이 재개를 허용한다. */
  @Post('jobs/:id/continue') @HttpCode(200) @Header('Cache-Control', 'no-store, private')
  async continue(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() input: unknown) { return (await this.service.continue(user.userId, id, input)).job; }
  /** 사용자 취소는 이후 도착한 결과로 되살리지 않는다. */
  @Post('jobs/:id/cancel') @HttpCode(200) @Header('Cache-Control', 'no-store, private')
  async cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() input: unknown) { return (await this.service.cancel(user.userId, id, input)).job; }
  /** 같은 claim의 실제 관측과 로그아웃 확인만 저장한다. */
  @Public() @Post('jobs/:id/complete') @HttpCode(200) @Header('Cache-Control', 'no-store, private')
  complete(@Req() request: FastifyRequest, @Param('id', new ParseUUIDPipe()) id: string, @Body() input: unknown) { return this.service.complete(this.bearer(request), id, input); }
  /** 본인 Mac만 철회할 수 있으며 다른 가족이 비밀값을 회전할 수 없다. */
  @Delete('runner/:id') @HttpCode(200) @Header('Cache-Control', 'no-store, private')
  revoke(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string, @Query('householdId') householdId: string) { return this.service.revoke(user.userId, id, { householdId }); }
}
