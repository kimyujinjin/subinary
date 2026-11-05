import { describe, expect, it } from "vitest";

import {
  INVITABLE_ROLES,
  ROLE_DESCRIPTION,
  ROLE_LABEL,
  isInvitableRole,
} from "./household-roles";

describe("가족 역할 이름", () => {
  it("보기 전용 권한은 연결 화면과 같은 '보기 전용'이라 부른다(영어 '뷰어' 금지)", () => {
    expect(ROLE_LABEL.viewer).toBe("보기 전용");
    expect(Object.values(ROLE_LABEL)).not.toContain("뷰어");
  });

  it("고를 수 있는 역할마다 한 줄 설명이 있고, 해요체다", () => {
    for (const role of INVITABLE_ROLES) {
      expect(ROLE_DESCRIPTION[role]).toMatch(/요$/);
    }
    expect(INVITABLE_ROLES[0]).toBe("member");
  });

  it("소유자는 고를 수 있는 역할이 아니다", () => {
    expect(isInvitableRole("owner")).toBe(false);
    expect(isInvitableRole("viewer")).toBe(true);
    expect(isInvitableRole("뷰어")).toBe(false);
  });
});
