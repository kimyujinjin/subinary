/**
 * `/ai-operations` 접근 제어 — 서버 전체 큐·경보 지표는 운영자 허용 목록에 있는 사람만 본다.
 *
 * 예전에는 아무 가족의 owner/admin이면 서버 전체 지표(다른 가족이 만든 큐 적체·경보 포함)를
 * 볼 수 있었다. 지금 규칙: `AI_OPERATIONS_OPERATOR_USER_IDS`에 있고 **그리고** 그 가족의
 * owner/admin이어야 한다. 목록이 비면 아무도 못 본다(fail closed).
 *
 * `packages/config`에는 test 스크립트가 없어(빌드 전용) 설정 파싱도 여기서 고정한다
 * (money-contract-config.test.ts와 같은 이유).
 */
import { ForbiddenException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import { validateEnv } from "@family/config";
import type { Db } from "@family/database";
import { QUEUE_NAMES } from "@family/shared";

import {
  LearningOperationsService,
  OPERATIONAL_QUEUE_NAMES,
} from "./learning-operations.service";

// 생성자가 큐마다 Redis 연결을 만들므로 BullMQ만 바꿔 끼운다(이름만 기억하는 가짜 큐).
// vi.mock은 import보다 먼저 실행되도록 끌어올려진다.
vi.mock("bullmq", () => ({
  Queue: class {
    constructor(readonly name: string) {}
    async close() {}
  },
}));

const OPERATOR = "11111111-1111-4111-8111-111111111111";
const OWNER_NOT_OPERATOR = "22222222-2222-4222-8222-222222222222";
const HOUSEHOLD = "33333333-3333-4333-8333-333333333333";

function harness(operatorUserIds: string[] | undefined, memberRows: unknown[]) {
  const limit = vi.fn(async () => memberRows);
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
  } as unknown as Db;
  const config = {
    get: (key: string) => {
      if (key === "redis") return { host: "localhost", port: 6379 };
      if (key === "queue") return { prefix: "fma" };
      if (key === "observability")
        return operatorUserIds === undefined
          ? undefined
          : { aiOperationsOperatorUserIds: operatorUserIds };
      return undefined;
    },
  } as unknown as ConfigService;
  const service = new LearningOperationsService(db, config);
  const assertOperator = (
    service as unknown as {
      assertOperator: (userId: string, householdId: string) => Promise<void>;
    }
  ).assertOperator.bind(service);
  return { service, assertOperator, limit };
}

describe("AI 처리 현황 — 운영자 허용 목록", () => {
  it("허용 목록이 비어 있으면 owner라도 403이고 DB를 읽지 않는다(fail closed)", async () => {
    for (const ids of [undefined, []]) {
      const { assertOperator, limit } = harness(ids, [{ role: "owner" }]);
      await expect(assertOperator(OPERATOR, HOUSEHOLD)).rejects.toBeInstanceOf(
        ForbiddenException
      );
      expect(limit).not.toHaveBeenCalled();
    }
  });

  it("목록 밖의 가족 owner는 403 — 가족 역할만으로는 서버 전체 지표를 보지 못한다", async () => {
    const { assertOperator, limit } = harness([OPERATOR], [{ role: "owner" }]);
    await expect(
      assertOperator(OWNER_NOT_OPERATOR, HOUSEHOLD)
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(limit).not.toHaveBeenCalled();
  });

  it("목록에 있어도 그 가족의 owner/admin이 아니면 403", async () => {
    const { assertOperator, limit } = harness([OPERATOR], []);
    await expect(assertOperator(OPERATOR, HOUSEHOLD)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(limit).toHaveBeenCalledTimes(1);
  });

  it("목록에 있고 owner/admin이면 통과한다(대소문자는 가리지 않는다)", async () => {
    const { assertOperator } = harness([OPERATOR], [{ role: "admin" }]);
    await expect(
      assertOperator(OPERATOR.toUpperCase(), HOUSEHOLD)
    ).resolves.toBeUndefined();
  });

  it("푸시 발송 큐도 함께 본다", () => {
    expect(OPERATIONAL_QUEUE_NAMES).toContain(
      QUEUE_NAMES.NOTIFICATION_DISPATCH
    );
    const { service } = harness([OPERATOR], []);
    const names = (
      service as unknown as { queues: Array<{ name: string }> }
    ).queues.map((queue) => queue.name);
    expect(names).toContain("notification-dispatch");
  });
});

/** validateEnv가 요구하는 최소 환경. 접근 제어와 무관한 값은 형식만 맞춘 더미다. */
function baseEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    TZ: "Asia/Seoul",
    API_PORT: "3001",
    WORKER_PORT: "3002",
    WEB_PORT: "3000",
    DATABASE_URL: "postgresql://u:p@localhost:5432/db",
    REDIS_HOST: "localhost",
    REDIS_PORT: "6379",
    BULLMQ_PREFIX: "fma",
    STORAGE_ENDPOINT: "http://localhost:9000",
    STORAGE_REGION: "us-east-1",
    STORAGE_ACCESS_KEY: "key",
    STORAGE_SECRET_KEY: "secret",
    STORAGE_BUCKET: "bucket",
    STORAGE_FORCE_PATH_STYLE: "true",
    AI_PROVIDER: "mock",
    JWT_ACCESS_SECRET: "0123456789abcdef0123456789abcdef",
    DEVICE_SECRET_ENC_KEY: "a".repeat(64),
    ...overrides,
  };
}

const ids = (env: Record<string, string>) =>
  validateEnv(baseEnv(env)).observability.aiOperationsOperatorUserIds;

describe("AI_OPERATIONS_OPERATOR_USER_IDS — 설정", () => {
  it("설정하지 않거나 빈 값이면 빈 목록이다(아무도 못 본다)", () => {
    expect(ids({})).toEqual([]);
    expect(ids({ AI_OPERATIONS_OPERATOR_USER_IDS: "" })).toEqual([]);
    expect(ids({ AI_OPERATIONS_OPERATOR_USER_IDS: " , " })).toEqual([]);
  });

  it("쉼표로 여러 명을 받고 공백·대소문자·중복을 정리한다", () => {
    expect(
      ids({
        AI_OPERATIONS_OPERATOR_USER_IDS: ` ${OPERATOR.toUpperCase()} ,${OWNER_NOT_OPERATOR},${OPERATOR}`,
      })
    ).toEqual([OPERATOR, OWNER_NOT_OPERATOR]);
  });

  it("형식이 틀린 항목이 있으면 부팅을 막는다 — 오타를 조용히 버리지 않는다", () => {
    expect(() =>
      ids({ AI_OPERATIONS_OPERATOR_USER_IDS: `${OPERATOR},soobeen` })
    ).toThrow(/aiOperationsOperatorUserIds/);
  });
});
