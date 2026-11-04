import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { QUEUE_DEFAULT_JOB_OPTIONS, QUEUE_NAMES } from "@family/shared";

import { ReviewRequestsController } from "./review-requests.controller";
import { ReviewRequestsService } from "./review-requests.service";

/** 가족에게 결제 물어보기. 알림은 워커의 notification-dispatch 큐가 보낸다. */
@Module({
  imports: [
    BullModule.registerQueue({
      name: QUEUE_NAMES.NOTIFICATION_DISPATCH,
      defaultJobOptions: QUEUE_DEFAULT_JOB_OPTIONS,
    }),
  ],
  controllers: [ReviewRequestsController],
  providers: [ReviewRequestsService],
})
export class ReviewRequestsModule {}
