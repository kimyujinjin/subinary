import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConnectionCard } from "./connection-card";
import { ConnectionRegistrationForm } from "./registration-form";
import { AssetConnectionsSummary } from "./asset-connections-summary";
import type { ComponentProps } from "react";
import { connectionFixture as item } from "./fixtures.test-support";

const card = (patch: Partial<typeof item> = {}, canManage = true, unconfirmed = false, enabled = true) => renderToStaticMarkup(
  <ConnectionCard item={{ ...item, ...patch }} disabled={false} enabled={enabled} canManage={canManage} unconfirmed={unconfirmed} onSelect={() => {}} onRefresh={() => {}} onDisconnect={() => {}} />,
);
describe("connection screen presentation contract", () => {
  it("renders empty password inputs, unselected consents, owner context and retention disclosure", () => {
    const html = renderToStaticMarkup(<ConnectionRegistrationForm busy={false} onSubmit={async () => {}} onClose={() => {}} />);
    expect((html.match(/type="password"/g) ?? [])).toHaveLength(2);
    expect((html.match(/type="checkbox"/g) ?? [])).toHaveLength(3);
    for (const checkbox of html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? []) {
      expect(checkbox).toContain('required=""');
    }
    expect(html).not.toContain("checked=");
    expect(html).not.toContain("value=");
    expect(html).toContain("다른 가족은 본인 앱 계정");
    expect(html).toContain("이전에 조회한 기록은 보관");
    expect(html).toContain("앱을 닫아 둔 동안에는 자동 조회하지 않아요");
    expect(html).toContain("자산 또는 연결 화면을 열 때 보유 주식을 새로 조회하는 데 동의해요");
    const steps = html.match(/<ol[^>]*aria-label="연결 순서"[^>]*>(.*?)<\/ol>/)?.[1] ?? "";
    expect(steps.indexOf("키 등록")).toBeLessThan(steps.indexOf("계좌 선택"));
    expect(steps.indexOf("계좌 선택")).toBeLessThan(steps.indexOf("조회"));
    expect((steps.match(/aria-current="step"/g) ?? [])).toHaveLength(1);
    expect(html.indexOf("<fieldset")).toBeLessThan(html.indexOf("<details"));
  });
  it("separates KRW and USD rather than presenting a combined asset total", () => {
    const html = card();
    expect(html).toContain("123,456.75원");
    expect(html).toContain("$98.00");
    expect(html).toContain("국내 주식");
    expect(html).toContain("미국 주식");
    expect(html).not.toContain("총자산");
  });
  it("distinguishes missing values from provider-supplied zero", () => {
    const html = card({ snapshot: { ...item.snapshot!, totals: [{ currency: "KRW", marketValue: "0", afterCostValue: "0" }], items: [] } });
    expect(html).toContain(">0원<");
    expect(html).toContain("조회 내역 없음");
    expect(html).not.toContain("$0.00");
    expect(html).toContain("조회된 보유 주식이 없어요");
  });
  it("retains stale values with a clear label for provider failure and unknown HTTP results", () => {
    expect(card({ status: "error", errorCode: "provider_unavailable" })).toContain("이전 조회 내역");
    const html = card({}, true, true);
    expect(html).toContain("조회 확인 필요");
    expect(html).toContain("이전 조회 내역");
    expect(html).toContain("123,456.75원");
  });
  it("labels a disabled service's saved snapshot as previous data", () => {
    const html = card({}, true, false, false);
    expect(html).toContain("이전 조회 내역");
    expect(html).toContain("123,456.75원");
    expect(html).toContain("$98.00");
    expect(html).toContain("마지막 조회 성공");
  });
  it("requires explicit choice even when there is only one verified account", () => {
    const html = card({ status: "select_account", snapshot: null, selectedAccountId: null, canRefresh: false });
    expect(html).toContain("계좌를 선택해 주세요");
    expect(html).toContain("합성 종합매매 계좌");
    expect(html).toContain("이 계좌 조회하기");
    expect(html).not.toContain(`value="${"a".repeat(64)}" selected`);
  });
  it("does not call account selection a successful holdings lookup", () => {
    const html = card({ snapshot: null, lastSuccessAt: null });
    expect(html).toContain("조회 전");
    expect(html).not.toContain("조회 완료");
  });
  it("offers no writes to a viewer", () => {
    const html = card({}, false);
    expect(html).not.toContain("새로 조회</button>");
    expect(html).not.toContain("연결 해제</button>");
  });
});

const assetSummary = (patch: Partial<ComponentProps<typeof AssetConnectionsSummary>> = {}) => renderToStaticMarkup(
  <AssetConnectionsSummary data={{ enabled: true, disabledReason: null, items: [item] }} busy={false} loading={false} notice={null} uncertainId={null} {...patch} />,
);
describe("asset screen connected account summary", () => {
  it("shows separate currencies, observation/valuation limits and a management link without write controls", () => {
    const html = assetSummary();
    expect(html).toContain('href="/more/connections"');
    expect(html).toContain("123,456.75원");
    expect(html).toContain("$98.00");
    expect(html).not.toContain("USD");
    expect(html).toContain("가족 합계에 더하지 않아요");
    expect(html).toContain("내 연결 계좌");
    expect(html).toContain("마지막 조회 성공");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("순자산");
  });
  it("discards previous values while access is being revalidated", () => {
    const html = assetSummary({ loading: true, busy: true });
    expect(html).toContain("연결 계좌를 확인하고 있어요");
    expect(html).not.toContain("123,456.75");
    expect(html).not.toContain("합성 종합매매 계좌");
    expect(html).not.toContain("연결한 토스증권 계좌가 없어요");
  });
  it("shows a failed permission/read check without restoring a snapshot or inventing zero", () => {
    const html = assetSummary({ data: null, notice: "연결을 볼 권한이 바뀌었어요." });
    expect(html).toContain('role="alert"');
    expect(html).toContain("권한이 바뀌었어요");
    expect(html).not.toContain("123,456.75");
    expect(html).not.toContain("0 원");
  });
  it("retains exact old values on provider failure or an unknown refresh", () => {
    const failed = assetSummary({ data: { enabled: true, disabledReason: null, items: [{ ...item, status: "error", errorCode: "provider_unavailable" }] } });
    expect(failed).toContain("이전 조회 내역");
    expect(failed).toContain("123,456.75원");
    expect(failed).toContain("조회 실패");
    const unknown = assetSummary({ uncertainId: item.id });
    expect(unknown).toContain("조회 확인 필요");
    expect(unknown).toContain("이전 조회 내역");
  });
  it("distinguishes empty, disabled and disconnected connections", () => {
    // 연결이 없으면 섹션을 그리지 않는다 — 연결 시작은 자산 추가 시트가 맡는다.
    expect(assetSummary({ data: { enabled: true, disabledReason: null, items: [] } })).toBe("");
    expect(assetSummary({ data: { enabled: false, disabledReason: "not_configured", items: [] } })).toBe("");
    const disconnected = assetSummary({ data: { enabled: true, disabledReason: null, items: [{ ...item, status: "disconnected" }] } });
    expect(disconnected).not.toContain("123,456.75");
  });
  it("preserves provider zero and keeps absent currency unfilled", () => {
    const html = assetSummary({ data: { enabled: true, disabledReason: null, items: [{ ...item, snapshot: { ...item.snapshot!, totals: [{ currency: "KRW", marketValue: "0", afterCostValue: "0" }] } }] } });
    expect(html).toContain(">0원<");
    expect(html).toContain("조회 내역 없음");
    expect(html).not.toContain("$0.00");
  });
  it("keeps an unselected account out of the values and directs selection to management", () => {
    const html = assetSummary({ data: { enabled: true, disabledReason: null, items: [{ ...item, status: "select_account", selectedAccountId: null, snapshot: null, lastSuccessAt: null, canRefresh: false }] } });
    expect(html).toContain("연결 관리에서 조회할 계좌를 선택해 주세요");
    expect(html).toContain("아직 없음");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("0 원");
  });
});
