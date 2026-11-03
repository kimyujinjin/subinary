import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe,
  Patch, Post, Query,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  manualAssetCreateRequestSchema, manualAssetUpdateRequestSchema,
  manualFinanceDeleteRequestSchema, manualFinanceListQuerySchema,
  manualHousingPlanCreateRequestSchema, manualHousingPlanUpdateRequestSchema,
  type ManualAssetListResponse, type ManualAssetResponse,
  type ManualFinanceDeleteResponse, type ManualHousingPlanListResponse,
  type ManualHousingPlanResponse,
} from '@family/contracts';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { ManualFinanceService } from './manual-finance.service';

class FinanceListDto extends createZodDto(manualFinanceListQuerySchema) {}
class HouseholdQueryDto extends createZodDto(z.object({ householdId: z.string().uuid() }).strict()) {}
class AssetCreateDto extends createZodDto(manualAssetCreateRequestSchema) {}
class AssetUpdateDto extends createZodDto(manualAssetUpdateRequestSchema) {}
class PlanCreateDto extends createZodDto(manualHousingPlanCreateRequestSchema) {}
class PlanUpdateDto extends createZodDto(manualHousingPlanUpdateRequestSchema) {}
class FinanceDeleteDto extends createZodDto(manualFinanceDeleteRequestSchema) {}

/** Normal user authentication only; no machine, public or admin bypass routes. */
@Controller('manual-finance')
export class ManualFinanceController {
  constructor(private readonly service: ManualFinanceService) {}

  @Get('assets')
  listAssets(@CurrentUser() user: AuthenticatedUser, @Query() query: FinanceListDto): Promise<ManualAssetListResponse> {
    return this.service.listAssets(user.userId, query);
  }

  @Post('assets')
  @HttpCode(HttpStatus.CREATED)
  createAsset(@CurrentUser() user: AuthenticatedUser, @Body() input: AssetCreateDto): Promise<ManualAssetResponse> {
    return this.service.createAsset(user.userId, input);
  }

  @Get('assets/:id')
  getAsset(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: HouseholdQueryDto): Promise<ManualAssetResponse> {
    return this.service.getAsset(user.userId, query.householdId, id);
  }

  @Patch('assets/:id')
  updateAsset(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: HouseholdQueryDto, @Body() input: AssetUpdateDto): Promise<ManualAssetResponse> {
    return this.service.updateAsset(user.userId, query.householdId, id, input);
  }

  @Delete('assets/:id')
  @HttpCode(HttpStatus.OK)
  deleteAsset(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: HouseholdQueryDto, @Body() input: FinanceDeleteDto): Promise<ManualFinanceDeleteResponse> {
    return this.service.deleteAsset(user.userId, query.householdId, id, input);
  }

  @Get('housing-plans')
  listPlans(@CurrentUser() user: AuthenticatedUser, @Query() query: FinanceListDto): Promise<ManualHousingPlanListResponse> {
    return this.service.listPlans(user.userId, query);
  }

  @Post('housing-plans')
  @HttpCode(HttpStatus.CREATED)
  createPlan(@CurrentUser() user: AuthenticatedUser, @Body() input: PlanCreateDto): Promise<ManualHousingPlanResponse> {
    return this.service.createPlan(user.userId, input);
  }

  @Get('housing-plans/:id')
  getPlan(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: HouseholdQueryDto): Promise<ManualHousingPlanResponse> {
    return this.service.getPlan(user.userId, query.householdId, id);
  }

  @Patch('housing-plans/:id')
  updatePlan(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: HouseholdQueryDto, @Body() input: PlanUpdateDto): Promise<ManualHousingPlanResponse> {
    return this.service.updatePlan(user.userId, query.householdId, id, input);
  }

  @Delete('housing-plans/:id')
  @HttpCode(HttpStatus.OK)
  deletePlan(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: HouseholdQueryDto, @Body() input: FinanceDeleteDto): Promise<ManualFinanceDeleteResponse> {
    return this.service.deletePlan(user.userId, query.householdId, id, input);
  }
}
