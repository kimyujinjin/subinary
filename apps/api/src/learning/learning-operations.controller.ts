import { Controller, Get, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';

import {
  learningOperationsMetricsQuerySchema,
  type LearningOperationsMetricsResponse,
} from '@family/contracts';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../auth/decorators/current-user.decorator';
import { LearningOperationsService } from './learning-operations.service';

class LearningOperationsMetricsQueryDto extends createZodDto(
  learningOperationsMetricsQuerySchema,
) {}

/**
 * 운영자 전용 AI 파이프라인 운영 지표 API — `AI_OPERATIONS_OPERATOR_USER_IDS`에 있고 그 가족의
 * owner/admin이어야 한다(서버 전체 큐·경보가 들어 있다). 아니면 403.
 */
@Controller('learning/operations')
export class LearningOperationsController {
  constructor(private readonly operationsService: LearningOperationsService) {}

  /** 원문·job payload·개별 사용자 식별자가 없는 집계만 반환한다. */
  @Get('metrics')
  getMetrics(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: LearningOperationsMetricsQueryDto,
  ): Promise<LearningOperationsMetricsResponse> {
    return this.operationsService.getMetrics(user.userId, query);
  }
}
