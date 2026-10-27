import { Controller, Get, Query } from '@nestjs/common';
import type { FinanceQuality } from '@family/contracts';

import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { FinanceQualityService } from './finance-quality.service';

/** 일반 사용자 인증으로 금융 품질만 읽는다. 원문·정정·유료 모델 호출은 포함하지 않는다. */
@Controller('analytics')
export class FinanceQualityController {
  constructor(private readonly financeQualityService: FinanceQualityService) {}

  /** GET /v1/analytics/quality — 본인 SMS 적체와 공개범위 내 거래 검토 건수. */
  @Get('quality')
  read(
    @CurrentUser() user: AuthenticatedUser,
    @Query('householdId') householdId?: string,
  ): Promise<FinanceQuality> {
    return this.financeQualityService.read(user.userId, householdId);
  }
}
