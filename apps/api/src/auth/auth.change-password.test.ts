import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { Db } from "@family/database";

import { AuthService } from "./auth.service";
import type { PasswordService } from "./password.service";
import type { TokenService } from "./token.service";

const USER = "11111111-1111-4111-8111-111111111111";

/** select → 준비한 사용자 행, update → 어떤 테이블에 무엇을 썼는지만 기록한다. */
function harness(options: {
  valid: boolean;
  user?: Record<string, unknown> | null;
}) {
  const updates: Array<{ table: string; values: Record<string, unknown>; where?: SQL }> = [];
  const user =
    options.user === undefined
      ? { id: USER, passwordHash: "old-hash", deletedAt: null }
      : options.user;
  const select = () => ({
    from: () => ({
      where: () => ({ limit: async () => (user ? [user] : []) }),
    }),
  });
  const update = (table: Table) => ({
    set: (values: Record<string, unknown>) => ({
      where: async (where?: SQL) => {
        updates.push({ table: getTableName(table), values, where });
      },
    }),
  });
  const passwordService = {
    verify: vi.fn(async () => options.valid),
    hash: vi.fn(async () => "new-hash"),
  };
  const service = new AuthService(
    { select, update } as unknown as Db,
    {} as TokenService,
    passwordService as unknown as PasswordService,
    {} as ConfigService
  );
  return { service, updates, passwordService };
}

describe("비밀번호 변경", () => {
  it("지금 비밀번호가 틀리면 400과 한국어 문구 — 401이면 앱이 세션 만료로 오인해 로그아웃했다", async () => {
    const { service, updates, passwordService } = harness({ valid: false });
    const failure = service.changePassword(USER, "wrong", "new-password-123");
    await expect(failure).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.changePassword(USER, "wrong", "new-password-123")
    ).rejects.toThrow("지금 비밀번호가 맞지 않아요.");
    expect(passwordService.hash).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it("바꾸면 비밀번호·모든 세션·모든 기기의 푸시 구독을 함께 끊는다", async () => {
    const { service, updates } = harness({ valid: true });
    await service.changePassword(USER, "right", "new-password-123");
    expect(updates.map((update) => update.table)).toEqual([
      "users",
      "user_sessions",
      "user_sessions",
      "push_subscriptions",
    ]);
    expect(updates[0]!.values).toMatchObject({ passwordHash: "new-hash" });
    expect(updates[1]!.values).toMatchObject({
      revokedReason: "password_change",
    });
    expect(updates[3]!.values.revokedAt).toBeInstanceOf(Date);
  });

  // 살아 있는 세션만 끊으면 24시간 안에 회전된 옛 토큰이 refresh 유예로 새 세션을 받았다(2026-11-06).
  it("유예 창 안의 회전된 옛 토큰도 같은 이유로 막는다 — 끊긴 시각은 기록으로 두고 이유만 바꾼다", async () => {
    const { service, updates } = harness({ valid: true });
    await service.changePassword(USER, "right", "new-password-123");
    const grace = updates[2]!;
    expect(grace.values).toEqual({ revokedReason: "password_change" });
    const query = new PgDialect().sqlToQuery(grace.where!);
    expect(query.sql).toContain('"revoked_at" is not null');
    expect(query.sql).toContain('"revoked_at" >=');
    expect(query.sql).toContain('"revoked_reason" is null');
    expect(query.params).toContain("rotated");
    expect(query.params).toContain(USER);
    const cutoff = query.params.find((p): p is string => typeof p === "string" && /^\d{4}-\d{2}-\d{2}T/.test(p));
    expect(cutoff).toBeDefined();
    const hours = (Date.now() - new Date(cutoff!).getTime()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThan(24.1);
  });

  it("탈퇴했거나 없는 사용자는 세션 문제로 본다(401)", async () => {
    const { service } = harness({ valid: true, user: null });
    await expect(
      service.changePassword(USER, "right", "new-password-123")
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
