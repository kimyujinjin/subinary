import { describe, expect, it } from "vitest";
import { bankStartRequest } from "./bank-start-model";

describe("은행 연동 준비 요청의 전달 범위", () => {
  it("사용자 입력을 받지 않는 불변 정적 요청을 반환한다", () => {
    expect(bankStartRequest.length).toBe(0);
    expect(bankStartRequest()).toBe(bankStartRequest());
    expect(Object.isFrozen(bankStartRequest())).toBe(true);
  });

  it("Codex 새 초안 링크에 같은 요청문 하나만 인코딩한다", () => {
    const request = bankStartRequest();
    const link = new URL(request.href);
    expect(link.protocol).toBe("codex:");
    expect(link.hostname).toBe("new");
    expect(link.pathname).toBe("");
    expect(link.username).toBe("");
    expect(link.password).toBe("");
    expect(link.hash).toBe("");
    expect([...link.searchParams.keys()]).toEqual(["prompt"]);
    expect(link.searchParams.get("prompt")).toBe(request.text);
  });

  it("정상 인증과 선택 계좌 읽기·로그아웃 및 실제 저장 확인을 요구한다", () => {
    const { text } = bankStartRequest();
    expect(text).toContain("https://app.subinary.cloud");
    expect(text).toContain("https://bank.shinhan.com");
    for (const instruction of ["지원되는 Computer Use(CUA)", "지원되지 않으면 중단", "은행 화면에 직접 입력",
      "선택한 통장 또는 대출", "읽기만", "정상 로그아웃", "인증된 저장 경로", "재확인까지 검증하지 않았다면"]) {
      expect(text).toContain(instruction);
    }
    expect(text).toContain("저장 성공이나 연동 완료라고 말하지 마세요");
  });

  it("이전 인증정보 재사용과 보안 우회·자금 이동을 금지한다", () => {
    const { text } = bankStartRequest();
    expect(text).toContain("과거 채팅이나 메모리에서 인증정보를 찾거나 재사용하지 마세요");
    expect(text).toContain("쿠키·세션 추출, 보안 우회, 이체·상환은 하지 마세요");
  });

  it("개인 식별값·자격증명·로컬 경로를 전달하지 않는다", () => {
    const { text, href } = bankStartRequest();
    expect(text).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/i);
    expect(text).not.toMatch(/\/Users\/|\/home\/|\.env|Bearer\s|userId|householdId|requestId|password=|token=/);
    expect(href).not.toContain("workspace=");
    expect(href).not.toContain("thread=");
    expect(text).not.toMatch(/\d{3,}/);
  });
});
