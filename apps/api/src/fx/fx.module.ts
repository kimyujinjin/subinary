import { Module } from '@nestjs/common';

import { FxController } from './fx.controller';
import { FxService } from './fx.service';

/** 화면 표시용 참고 환율. DB에 의존하지 않는다. */
@Module({ controllers: [FxController], providers: [FxService] })
export class FxModule {}
