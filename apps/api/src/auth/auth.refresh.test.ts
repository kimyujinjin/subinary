import { UnauthorizedException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { Db, schema } from "@family/database";

import { AuthService } from "./auth.service";
import type { PasswordService } from "./password.service";
import type { TokenService } from "./token.service";

const USER = "11111111-1111-4111-8111-111111111111";
const HOUR_MS = 3_600_000;
const REFRESH_TTL_SEC = 30 * 24 * 60 * 60;
// auth.service.ts 의 REUSE_BURST_THRESHOLD(내보내지 않음)와 같은 값 — 서로 다른 죽은 토큰 3개.
const REUSE_BURST_THRESHOLD = 3;

type SessionRow = typeof schema.userSessions.$inferSelect;
type RevokedReason = SessionRow["revokedReason"];

/** n번째 옛 세션: 원문 토큰 `old-n`, revokedHoursAgo 시간 전에 reason 으로 끊겼다. */
function deadSession(
  n: number,
  reason: RevokedReason,
  revokedHoursAgo: number
): SessionRow {
  const now = Date.now();
  const createdAt = new Date(now - 48 * HOUR_MS);
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    userId: USER,
    refreshTokenHash: `hash-of-old-${n}`,
    expiresAt: new Date(createdAt.getTime() + REFRESH_TTL_SEC * 1_000),
    revokedAt: new Date(now - revokedHoursAgo * HOUR_MS),
    revokedReason: reason,
    userAgent: null,
    createdAt,
  };
}

/**
 * 가짜 Db: select 는 where 의 실제 파라미터로 행을 찾고(제시한 토큰의 해시가 맞아야 세션이 나온다),
 * update·insert 는 어떤 테이블에 무엇을 썼는지만 기록한다.
 */
function harness(sessions: SessionRow[]) {
  const dialect = new PgDialect();
  const selects: string[] = [];
  const updates: Array<{
    table: string;
    values: Record<string, unknown>;
    where: SQL;
  }> = [];
  const inserts: Array<{ table: string; values: Record<string, unknown> }> = [];
  const user = {
    id: USER,
    email: "family@example.com",
    name: "가족",
    passwordHash: "unused",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
  };

  const select = () => ({
    from: (table: Table) => ({
      where: (where: SQL) => ({
        limit: async () => {
          const name = getTableName(table);
          selects.push(name);
          const { params } = dialect.sqlToQuery(where);
          if (name === "user_sessions") {
            return sessions.filter((s) => params.includes(s.refreshTokenHash));
          }
          if (name === "users") {
            return params.includes(user.id) ? [user] : [];
          }
          throw new Error(`예상하지 않은 조회: ${name}`);
        },
      }),
    }),
  });
  const update = (table: Table) => ({
    set: (values: Record<string, unknown>) => ({
      where: async (where: SQL) => {
        updates.push({ table: getTableName(table), values, where });
      },
    }),
  });
  const insert = (table: Table) => ({
    values: async (values: Record<string, unknown>) => {
      inserts.push({ table: getTableName(table), values });
    },
  });

  // refresh → createSession 이 실제로 부르는 것만 둔다.
  const tokenService = {
    hashToken: vi.fn((raw: string) => `hash-of-${raw}`),
    refreshTtlSeconds: REFRESH_TTL_SEC,
    refreshTtlMobileSeconds: 365 * 24 * 60 * 60,
    issueAccessToken: vi.fn(async () => ({
      accessToken: "access-stub",
      expiresInSec: 900,
    })),
    generateRefreshToken: vi.fn(() => ({
      raw: "next-refresh-stub",
      hash: "next-hash",
    })),
  };

  // recordReuse 는 인스턴스 메모리 상태다 — 케이스마다 harness 를 새로 만들어 새 AuthService 를 쓴다.
  const service = new AuthService(
    { select, update, insert } as unknown as Db,
    tokenService as unknown as TokenService,
    {} as PasswordService,
    {} as ConfigService
  );
  const sessionUpdates = () =>
    updates.filter((u) => u.table === "user_sessions");
  return { service, selects, updates, inserts, sessionUpdates, tokenService };
}

describe("refresh — 명시적으로 끊긴 세션은 유예 없이 그 요청만 거절한다", () => {
  // revokeAllSessions 가 유예 창 안의 회전 행을 이 이유들로 바꾼다. 그 행이 다시 오면 401 만 나야 하고,
  // 전 세션 무효화(=user_sessions UPDATE)나 새 세션 발급이 일어나면 자동 로그인 회귀다.
  it.each(["password_change", "reuse_detected", "logout"] as const)(
    "1시간 전에 '%s' 로 끊긴 토큰 → 401, 세션 UPDATE·INSERT 없음",
    async (reason) => {
      const { service, selects, updates, inserts, tokenService } = harness([
        deadSession(1, reason, 1),
      ]);
      await expect(service.refresh("old-1")).rejects.toBeInstanceOf(
        UnauthorizedException
      );
      expect(updates).toEqual([]);
      expect(inserts).toEqual([]);
      expect(selects).toEqual(["user_sessions"]);
      expect(tokenService.issueAccessToken).not.toHaveBeenCalled();
      expect(tokenService.generateRefreshToken).not.toHaveBeenCalled();
    }
  );

  it("'password_change' 인 서로 다른 세션 3개를 연달아 내도 셋 다 401 — 폭주로 세지 않는다", async () => {
    const sessions = [1, 2, 3].map((n) => deadSession(n, "password_change", 1));
    const { service, updates, inserts } = harness(sessions);
    for (const n of [1, 2, 3]) {
      await expect(service.refresh(`old-${n}`)).rejects.toBeInstanceOf(
        UnauthorizedException
      );
    }
    expect(updates).toEqual([]);
    expect(inserts).toEqual([]);
  });

  it("'password_change' 거절은 폭주 집계에 들어가지 않는다 — 그 뒤 창 밖 회전 토큰 1개로는 무효화하지 않는다", async () => {
    const { service, sessionUpdates } = harness([
      deadSession(1, "password_change", 1),
      deadSession(2, "password_change", 1),
      deadSession(3, "rotated", 25),
    ]);
    for (const n of [1, 2, 3]) {
      await expect(service.refresh(`old-${n}`)).rejects.toBeInstanceOf(
        UnauthorizedException
      );
    }
    expect(sessionUpdates()).toEqual([]);
  });
});

describe("refresh — 대조군: 회전으로 끊긴 세션", () => {
  // NULL 은 0045 이전 행이라 회전과 같은 유예를 받는다(revokeAllSessions 가 함께 바꾸는 이유).
  it.each(["rotated", null] as const)(
    "1시간 전 '%s' → 거절하지 않고 회전해 새 세션을 준다",
    async (reason) => {
      const session = deadSession(1, reason, 1);
      const { service, updates, inserts, tokenService } = harness([session]);
      const result = await service.refresh("old-1", "test-agent");

      expect(result.refresh.raw).toBe("next-refresh-stub");
      expect(result.tokens.accessToken).toBe("access-stub");
      expect(result.user.id).toBe(USER);
      expect(tokenService.issueAccessToken).toHaveBeenCalledTimes(1);

      // 제시된 세션 하나만 'rotated' 로 다시 끊는다 — 사용자 전체(revokeAllSessions)가 아니다.
      expect(updates).toHaveLength(1);
      expect(updates[0]!.table).toBe("user_sessions");
      expect(updates[0]!.values).toMatchObject({ revokedReason: "rotated" });
      const { params } = new PgDialect().sqlToQuery(updates[0]!.where);
      expect(params).toEqual([session.id]);

      expect(inserts).toHaveLength(1);
      expect(inserts[0]).toMatchObject({
        table: "user_sessions",
        values: {
          userId: USER,
          refreshTokenHash: "next-hash",
          userAgent: "test-agent",
        },
      });
    }
  );

  it(`창 밖(25시간 전) 'rotated' 인 서로 다른 세션 ${REUSE_BURST_THRESHOLD}개 → ${REUSE_BURST_THRESHOLD}번째에서 전 세션을 'reuse_detected' 로 끊는다`, async () => {
    const sessions = Array.from({ length: REUSE_BURST_THRESHOLD }, (_, i) =>
      deadSession(i + 1, "rotated", 25)
    );
    const { service, sessionUpdates, inserts } = harness(sessions);

    for (let n = 1; n < REUSE_BURST_THRESHOLD; n++) {
      await expect(service.refresh(`old-${n}`)).rejects.toBeInstanceOf(
        UnauthorizedException
      );
      expect(sessionUpdates()).toEqual([]);
    }

    await expect(
      service.refresh(`old-${REUSE_BURST_THRESHOLD}`)
    ).rejects.toBeInstanceOf(UnauthorizedException);
    const revokes = sessionUpdates();
    expect(revokes.length).toBeGreaterThan(0);
    for (const revoke of revokes) {
      expect(revoke.values.revokedReason).toBe("reuse_detected");
      expect(new PgDialect().sqlToQuery(revoke.where).params).toContain(USER);
    }
    expect(inserts).toEqual([]);
  });

  it("창 밖 'rotated' 같은 세션을 3번 내면 1개로 센다 — 다중 탭 동시 제시는 폭주가 아니다", async () => {
    const { service, sessionUpdates } = harness([
      deadSession(1, "rotated", 25),
    ]);
    for (let i = 0; i < REUSE_BURST_THRESHOLD; i++) {
      await expect(service.refresh("old-1")).rejects.toBeInstanceOf(
        UnauthorizedException
      );
    }
    expect(sessionUpdates()).toEqual([]);
  });
});
