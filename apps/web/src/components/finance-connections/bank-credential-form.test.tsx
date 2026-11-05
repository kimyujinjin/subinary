import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BankCredentialForm } from "./bank-credential-form";

vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ authedFetch: vi.fn() }) }));
const scope = { householdId: "00000000-0000-4000-8000-000000000001", runnerId: "00000000-0000-4000-8000-000000000002" };
const stored = { stored: true, runnerId: scope.runnerId, version: 1, updatedAt: "2026-11-03T00:00:00Z" };
describe("본인 Mac의 신한 자동 로그인 설정", () => {
  it("빈 보안 입력과 저장·전달 동의를 별도로 제공한다", () => {
    const html = renderToStaticMarkup(<BankCredentialForm {...scope} credentials={null} storageAvailable disabled={false} onChanged={vi.fn()} />);
    expect(html).toContain('type="password"'); expect(html).toContain('name="consent"'); expect(html).toContain("암호화"); expect(html).toContain("본인 Mac");
    expect(html).toContain('method="post"');
    expect(html).not.toContain('value="'); expect(html).not.toContain(">로그인 정보 삭제</button>");
    // 흰 시트 위 입력칸은 공용 채움형(bg-muted)이다 — 흰 배경·테두리로 덮으면 칸이 보이지 않는다.
    const inputs = html.match(/<input[^>]*name="(loginId|password)"[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(2);
    for (const input of inputs) { expect(input).toContain("bg-muted"); expect(input).not.toMatch(/bg-(background|card)\b/); }
    // 동의 체크는 공용 체크박스(테두리 대비 3:1)다 — 브라우저 기본 체크박스가 아니다.
    expect(html).toMatch(/<span data-slot="checkbox"[^>]*><input[^>]*name="consent"/);
    expect(html).not.toContain("accent-primary");
    // 은행 비밀번호는 글자로 보이게 하는 토글을 두지 않는다(키보드가 단어로 배울 수 있다).
    expect(html).not.toContain("비밀번호 보기");
    // 결과 알림은 저장하기 전에는 없다.
    expect(html).not.toContain('role="alert"'); expect(html).not.toContain('role="status"');
  });
  it("저장 후에도 ID·비밀번호를 다시 표시하지 않고, 지우기는 시트 위에 창을 겹치지 않게 ⋯ 메뉴가 맡는다", () => {
    const html = renderToStaticMarkup(<BankCredentialForm {...scope} credentials={stored} storageAvailable disabled={false} onChanged={vi.fn()} onSaved={vi.fn()} />);
    expect(html).toContain("암호화 저장됨"); expect(html).toMatch(/<button[^>]*type="submit"[^>]*>저장하기<\/button>/);
    // 동의 문구('로그인 정보 삭제 시 … 폐기돼요')에는 남지만 누르는 삭제는 없다.
    expect(html).not.toMatch(/<button[^>]*>[^<]*삭제/); expect(html).not.toContain('value="');
  });
  it("진행 중이거나 암호화 저장소가 준비되지 않으면 입력·저장을 막는다", () => {
    for (const disabled of [true, false]) {
      const html = renderToStaticMarkup(<BankCredentialForm {...scope} credentials={stored} storageAvailable={disabled} disabled={disabled} onChanged={vi.fn()} />);
      expect(html).toContain('<fieldset disabled=""');
      if (!disabled) {
        expect(html).toContain("암호화 저장을 사용할 수 없어요");
        // 실패 알림은 색·아이콘이 있는 공용 줄(role="alert")이다.
        expect(html).toMatch(/<div[^>]*role="alert"[^>]*class="[^"]*text-destructive/);
      }
    }
  });
});
