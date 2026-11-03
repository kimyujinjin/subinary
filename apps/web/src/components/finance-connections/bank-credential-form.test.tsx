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
  });
  it("저장 후에도 ID·비밀번호를 다시 표시하지 않으며 삭제할 수 있다", () => {
    const html = renderToStaticMarkup(<BankCredentialForm {...scope} credentials={stored} storageAvailable disabled={false} onChanged={vi.fn()} />);
    expect(html).toContain("암호화 저장됨"); expect(html).toContain("로그인 정보 변경"); expect(html).toContain("로그인 정보 삭제"); expect(html).not.toContain('value="');
  });
  it("진행 중이거나 암호화 저장소가 준비되지 않으면 입력·저장을 막는다", () => {
    for (const disabled of [true, false]) {
      const html = renderToStaticMarkup(<BankCredentialForm {...scope} credentials={stored} storageAvailable={disabled} disabled={disabled} onChanged={vi.fn()} />);
      expect(html).toContain('<fieldset disabled=""');
      if (!disabled) expect(html).toContain("암호화 저장을 사용할 수 없어요");
    }
  });
});
