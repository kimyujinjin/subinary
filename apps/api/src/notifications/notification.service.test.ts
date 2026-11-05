/**
 * 알림함 숫자 일치 + 종류별 끄기(0074) 회귀 테스트.
 *
 * DB 경계만 바꿔 끼우고 서비스가 만든 Drizzle 조건을 그대로 SQL로 렌더링해 본다.
 *  - 벨 숫자(unread-count)와 목록이 **같은 30일 창**을 쓴다. 예전에는 숫자만 기간 제한이
 *    없어 오래된 안읽음이 목록에는 없는데 벨에만 남았다.
 *  - 옛 앱 번들은 `disabledKinds` 없이 PUT한다 — 그때 저장된 값을 덮지 않는다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Db } from "@family/database";
import { notificationPreferencesUpdateRequestSchema } from "@family/contracts";

import {
  NOTIFICATION_INBOX_WINDOW_DAYS,
  NotificationService,
  normalizeDisabledKinds,
} from "./notification.service";

const USER = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-05T03:00:00.000Z");
const WINDOW_START_ISO = new Date(
  NOW.getTime() - NOTIFICATION_INBOX_WINDOW_DAYS * 24 * 60 * 60 * 1000
).toISOString();
const dialect = new PgDialect();

interface Captured {
  wheres: Array<{ table: string; sql: string; params: unknown[] }>;
  inserts: Array<{
    table: string;
    values: Record<string, unknown>;
    set?: Record<string, unknown>;
  }>;
  updates: Array<{
    table: string;
    values: Record<string, unknown>;
    sql: string;
  }>;
}

/** select → 준비한 행, insert/update → 무엇을 썼는지만 기록한다. */
function harness(rows: { select?: unknown[]; returning?: unknown[] } = {}) {
  const captured: Captured = { wheres: [], inserts: [], updates: [] };
  const render = (table: Table, condition: SQL) => {
    const query = dialect.sqlToQuery(condition);
    captured.wheres.push({
      table: getTableName(table),
      sql: query.sql,
      params: query.params,
    });
  };
  const select = () => ({
    from: (table: Table) => ({
      where: (condition: SQL) => {
        render(table, condition);
        const result = Promise.resolve(rows.select ?? []);
        return Object.assign(result, {
          limit: async () => rows.select ?? [],
          orderBy: () => ({ limit: async () => rows.select ?? [] }),
        });
      },
    }),
  });
  const insert = (table: Table) => ({
    values: (values: Record<string, unknown>) => {
      const entry: Captured["inserts"][number] = {
        table: getTableName(table),
        values,
      };
      captured.inserts.push(entry);
      return {
        onConflictDoUpdate: (config: { set: Record<string, unknown> }) => {
          entry.set = config.set;
          return { returning: async () => rows.returning ?? [] };
        },
      };
    },
  });
  const update = (table: Table) => ({
    set: (values: Record<string, unknown>) => ({
      where: async (condition: SQL) => {
        captured.updates.push({
          table: getTableName(table),
          values,
          sql: dialect.sqlToQuery(condition).sql,
        });
      },
    }),
  });
  const service = new NotificationService({
    select,
    insert,
    update,
  } as unknown as Db);
  return { service, captured };
}

const oldClientBody = {
  pushEnabled: true,
  minAmount: 10_000,
  quietStartMinute: 22 * 60,
  quietEndMinute: 7 * 60,
  notifyOwnCollected: false,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("알림함 — 벨 숫자와 목록은 같은 30일 창을 쓴다", () => {
  it("안읽음 개수는 30일 안의 내 안읽음만 센다", async () => {
    const { service, captured } = harness({ select: [{ count: "3" }] });
    await expect(service.unreadCount(USER)).resolves.toEqual({ count: 3 });
    const [where] = captured.wheres;
    expect(where?.table).toBe("notifications");
    expect(where?.sql).toContain('"read_at" is null');
    expect(where?.sql).toContain('"created_at" >=');
    expect(where?.params).toEqual([USER, WINDOW_START_ISO]);
  });

  it("목록도 같은 시작 시각으로 자른다", async () => {
    const { service, captured } = harness({ select: [] });
    await service.listNotifications(USER, undefined, undefined);
    const [where] = captured.wheres;
    expect(where?.sql).toContain('"created_at" >=');
    expect(where?.params).toContain(WINDOW_START_ISO);
  });

  it("전체 읽음은 창 밖의 오래된 안읽음까지 지운다(불러오지 않은 페이지 포함)", async () => {
    const { service, captured } = harness();
    await service.markAllRead(USER);
    const [update] = captured.updates;
    expect(update?.table).toBe("notifications");
    expect(update?.values.readAt).toBeInstanceOf(Date);
    expect(update?.sql).toContain('"read_at" is null');
    expect(update?.sql).not.toContain('"created_at"');
  });
});

describe("알림 설정 — 종류별 끄기", () => {
  it("설정한 적이 없으면 모든 종류를 받는다(빈 목록)", async () => {
    const { service } = harness({ select: [] });
    await expect(service.getPreferences(USER)).resolves.toMatchObject({
      pushEnabled: true,
      notifyOwnCollected: false,
      disabledKinds: [],
    });
  });

  it("저장된 목록은 아는 종류만 유형 순서로 중복 없이 돌려준다", async () => {
    const { service } = harness({
      select: [
        {
          ...oldClientBody,
          userId: USER,
          disabledKinds: ["upcoming", "budget", "retired-kind", "budget"],
        },
      ],
    });
    const prefs = await service.getPreferences(USER);
    expect(prefs.disabledKinds).toEqual(["budget", "upcoming"]);
  });

  it("옛 번들이 disabledKinds 없이 저장하면 끈 종류를 덮지 않고, 응답은 저장된 값을 준다", async () => {
    const { service, captured } = harness({
      returning: [{ disabledKinds: ["decline", "summary"] }],
    });
    const body =
      notificationPreferencesUpdateRequestSchema.parse(oldClientBody);
    expect(body).not.toHaveProperty("disabledKinds");
    const saved = await service.updatePreferences(USER, body);
    const [insert] = captured.inserts;
    expect(insert?.table).toBe("notification_preferences");
    // 행이 없던 사용자는 기본값(모두 받음)으로 만든다.
    expect(insert?.values.disabledKinds).toEqual([]);
    // 행이 있던 사용자는 그 열을 건드리지 않는다.
    expect(insert?.set).not.toHaveProperty("disabledKinds");
    expect(insert?.set?.pushEnabled).toBe(true);
    expect(saved.disabledKinds).toEqual(["summary", "decline"]);
  });

  it("새 번들이 보낸 목록은 정규화해서 그대로 저장한다", async () => {
    const { service, captured } = harness({
      returning: [{ disabledKinds: ["transaction", "upcoming"] }],
    });
    const saved = await service.updatePreferences(USER, {
      ...oldClientBody,
      disabledKinds: ["upcoming", "transaction", "upcoming"],
    });
    const [insert] = captured.inserts;
    expect(insert?.values.disabledKinds).toEqual(["transaction", "upcoming"]);
    expect(insert?.set?.disabledKinds).toEqual(["transaction", "upcoming"]);
    expect(saved.disabledKinds).toEqual(["transaction", "upcoming"]);
  });

  it("빈 목록을 보내면 다시 모두 받는다(생략과 다르다)", async () => {
    const { service, captured } = harness({
      returning: [{ disabledKinds: [] }],
    });
    await service.updatePreferences(USER, {
      ...oldClientBody,
      disabledKinds: [],
    });
    expect(captured.inserts[0]?.set?.disabledKinds).toEqual([]);
  });

  it("normalizeDisabledKinds는 null·undefined를 빈 목록으로 본다", () => {
    expect(normalizeDisabledKinds(null)).toEqual([]);
    expect(normalizeDisabledKinds(undefined)).toEqual([]);
  });
});

describe("알림 설정 요청 계약", () => {
  it('무음 시간대의 시작과 끝이 같으면 거절한다 — 발송 쪽은 그 값을 "무음 없음"으로 읽는다', () => {
    const result = notificationPreferencesUpdateRequestSchema.safeParse({
      ...oldClientBody,
      quietStartMinute: 600,
      quietEndMinute: 600,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      "무음 시간대의 시작과 끝을 다르게 정해 주세요"
    );
  });

  it("무음 시간대를 끈 요청(둘 다 null)과 자정을 넘는 구간은 그대로 받는다", () => {
    expect(
      notificationPreferencesUpdateRequestSchema.safeParse({
        ...oldClientBody,
        quietStartMinute: null,
        quietEndMinute: null,
      }).success
    ).toBe(true);
    expect(
      notificationPreferencesUpdateRequestSchema.safeParse(oldClientBody)
        .success
    ).toBe(true);
  });

  it("모르는 종류와 DB 범위를 넘는 최소 금액은 거절한다", () => {
    expect(
      notificationPreferencesUpdateRequestSchema.safeParse({
        ...oldClientBody,
        disabledKinds: ["budget", "marketing"],
      }).success
    ).toBe(false);
    expect(
      notificationPreferencesUpdateRequestSchema.safeParse({
        ...oldClientBody,
        minAmount: 2_147_483_648,
      }).success
    ).toBe(false);
  });
});
