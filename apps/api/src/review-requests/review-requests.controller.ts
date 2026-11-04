import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import type {
  ReviewRequestListResponse,
  ReviewRequestResolveResponse,
  ReviewRequestSummary,
} from "@family/contracts";

import {
  CurrentUser,
  type AuthenticatedUser,
} from "../auth/decorators/current-user.decorator";
import { ReviewRequestsService } from "./review-requests.service";

/** 가족에게 결제 물어보기. 전역 access-token 가드가 적용된다. */
@Controller("review-requests")
export class ReviewRequestsController {
  constructor(private readonly service: ReviewRequestsService) {}

  /** 나와 관련된 열린 요청(받은 것·보낸 것). `transactionId`를 주면 그 결제만. */
  @Get()
  @Header("Cache-Control", "no-store, private")
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("householdId") householdId: string,
    @Query("transactionId") transactionId?: string
  ): Promise<ReviewRequestListResponse> {
    return this.service.list(user.userId, householdId, transactionId);
  }

  @Post()
  @HttpCode(200)
  @Header("Cache-Control", "no-store, private")
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown
  ): Promise<ReviewRequestSummary> {
    return this.service.create(user.userId, input);
  }

  @Post(":id/resolve")
  @HttpCode(200)
  @Header("Cache-Control", "no-store, private")
  resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() input: unknown
  ): Promise<ReviewRequestResolveResponse> {
    return this.service.resolve(user.userId, id, input);
  }
}
