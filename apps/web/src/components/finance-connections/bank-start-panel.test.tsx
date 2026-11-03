import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bankStartRequest } from "./bank-start-model";
import { BankStartPanel, BankStartPanelBody, copyBankStartRequest } from "./bank-start-panel";

afterEach(() => { vi.unstubAllGlobals(); });

const body = (overrides: Partial<Parameters<typeof BankStartPanelBody>[0]> = {}) => renderToStaticMarkup(
  <BankStartPanelBody panelId="bank-start-test" disabled={false} copying={false} manualCopy={false} macConfirmed={false} feedback={null}
    onConfirmMac={() => {}} onOpenCodex={() => {}} onCopy={() => {}} onClose={() => {}} {...overrides} />,
);

describe("신한 연동 준비 패널 표시", () => {
  it("첫 SSR에는 접힌 시작 버튼만 표시하고 외부 동작을 하지 않는다", () => {
    const fetch = vi.fn(() => { throw new Error("요청 금지"); });
    const writeText = vi.fn(() => Promise.reject(new Error("쓰기 금지")));
    vi.stubGlobal("fetch", fetch); vi.stubGlobal("navigator", { clipboard: { writeText } });
    const html = renderToStaticMarkup(<BankStartPanel />);
    expect(html).toContain("신한은행 연동");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("aria-controls=");
    expect(html).not.toContain("codex://");
    expect(html).not.toContain("<section");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<textarea");
    expect(fetch).not.toHaveBeenCalled(); expect(writeText).not.toHaveBeenCalled();
  });

  it("disabled 시작 버튼은 펼쳐지거나 Codex 링크를 노출하지 않는다", () => {
    const html = renderToStaticMarkup(<BankStartPanel disabled />);
    expect(html).toContain("disabled");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("codex://");
  });

  it("준비와 실제 조회·저장의 차이 및 Mac·모바일 경로를 설명한다", () => {
    const html = body();
    expect(html).toContain('id="bank-start-test"');
    expect(html).toContain('aria-labelledby="bank-start-test-heading"');
    expect(html).toContain("신한은행 연동 준비");
    expect(html).toContain("Codex에서 보내기를 눌러야 시작");
    expect(html).toContain("조회·자동저장은 아직 연결되지 않아 금액이 모아에 반영되지 않아요");
    expect(html).toContain("Codex가 설치된 Mac");
    expect(html).toContain("모바일에서는 요청문을 복사");
    expect(html).toContain("휴대폰 앱에서는 Codex 열기 링크가 작동하지 않을 수 있어요");
    expect(html).toContain("요청문 복사");
    expect(html).not.toContain("codex://");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<form");
  });

  it("사용자가 Mac 환경을 확인한 뒤에만 Codex 링크를 제공한다", () => {
    const html = body({ macConfirmed: true });
    expect(html).toContain("Mac에서만 아래 링크를 눌러 주세요");
    expect(html).toContain("Mac의 Codex에서 열기");
    expect(html).toContain(bankStartRequest().href);
    expect(html).toContain('aria-pressed="true"');
  });

  it("Codex를 열어도 실행·저장 완료로 표시하지 않는다", () => {
    const html = body({ feedback: "open_requested" });
    expect(html).toContain('role="status"');
    expect(html).toContain("Codex 열기 요청");
    expect(html).not.toContain("연동을 완료");
    expect(html).not.toContain("저장했어요");
  });

  it("복사 중에는 복사 버튼을 막고 재시도 가능한 수동 복사를 제공한다", () => {
    const copying = body({ copying: true });
    expect(copying).toMatch(/<button[^>]*disabled[^>]*>복사 중…<\/button>/);
    const manual = body({ manualCopy: true });
    expect(manual).toContain('role="alert"');
    expect(manual).toContain("요청문 다시 복사");
    expect(manual).toMatch(/<textarea[^>]*readOnly[^>]*>/i);
    expect(manual).toContain(bankStartRequest().text);
    expect(manual).not.toContain("type=\"password\"");
  });

  it("복사 성공은 보내기 안내로만 표시하며 비활성 링크는 목적지를 갖지 않는다", () => {
    const copied = body({ feedback: "copied" });
    expect(copied).toContain("붙여넣고 보내기를 눌러 주세요");
    const disabled = body({ disabled: true, macConfirmed: true });
    expect(disabled).toContain('aria-disabled="true"');
    expect(disabled).not.toContain("codex://");
  });
});

describe("고정 요청문 클립보드 쓰기", () => {
  it("writeText만 호출하고 읽기 기능이나 금융 API를 사용하지 않는다", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const readText = vi.fn(() => { throw new Error("읽기 금지"); });
    const fetch = vi.fn(() => { throw new Error("요청 금지"); });
    vi.stubGlobal("navigator", { clipboard: { writeText, readText } }); vi.stubGlobal("fetch", fetch);
    await expect(copyBankStartRequest()).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(bankStartRequest().text);
    expect(readText).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it("navigator 또는 writeText가 없으면 수동 복사를 선택한다", async () => {
    vi.stubGlobal("navigator", undefined);
    await expect(copyBankStartRequest()).resolves.toBe(false);
    vi.stubGlobal("navigator", {});
    await expect(copyBankStartRequest()).resolves.toBe(false);
    vi.stubGlobal("navigator", { clipboard: {} });
    await expect(copyBankStartRequest()).resolves.toBe(false);
  });

  it("지원 검사 예외·동기 예외·비동기 거절을 외부에 노출하지 않는다", async () => {
    vi.stubGlobal("navigator", { get clipboard(): never { throw new Error("접근 거절"); } });
    await expect(copyBankStartRequest()).resolves.toBe(false);
    vi.stubGlobal("navigator", { clipboard: { writeText: () => { throw new Error("동기 거절"); } } });
    await expect(copyBankStartRequest()).resolves.toBe(false);
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("비동기 거절")) } });
    await expect(copyBankStartRequest()).resolves.toBe(false);
  });

  it("한 번 실패한 뒤의 새 복사 요청은 다시 시도할 수 있다", async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error("거절")).mockResolvedValueOnce(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(copyBankStartRequest()).resolves.toBe(false);
    await expect(copyBankStartRequest()).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledTimes(2);
  });
});
