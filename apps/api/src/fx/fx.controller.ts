import { Controller, Get, Header, Query } from '@nestjs/common';
import type { FxReference } from '@family/contracts';

import { FxService } from './fx.service';

/** 전역 access-token 가드가 적용된다. 개인 데이터는 없고 공개 기준환율만 돌려준다. */
@Controller('fx')
export class FxController {
  constructor(private readonly service: FxService) {}

  @Get('reference') @Header('Cache-Control', 'private, max-age=600')
  reference(@Query('base') base?: string): Promise<FxReference> {
    return this.service.reference(base);
  }
}
