import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AssetRow, type AssetRowData } from "./asset-row";

const base: AssetRowData = {
  key: "r1",
  title: "합성 통장",
  subtitle: "가족",
  amount: 1000n,
  counted: true,
  chip: null,
};
const render = (row: Partial<AssetRowData>) =>
  renderToStaticMarkup(<AssetRow kind="account" row={{ ...base, ...row }} />);
const CHEVRON = "lucide-chevron-right";

describe("자산 목록 줄 — 누를 수 있는 줄만 ›", () => {
  it("창을 여는 줄은 버튼이고 ›가 있다", () => {
    const html = render({ onClick: () => {} });
    expect(html).toContain("<button");
    expect(html).toContain(CHEVRON);
  });
  it("다른 화면으로 가는 줄은 링크이고 ›가 있다", () => {
    const html = render({ href: "/more/connections?provider=toss_securities" });
    expect(html).toContain('href="/more/connections?provider=toss_securities"');
    expect(html).toContain(CHEVRON);
  });
  it("누를 수 없는 줄(가족 연결 계좌·수정할 수 없는 대출)은 ›도 눌림 표시도 없다", () => {
    const html = render({});
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain(CHEVRON);
    expect(html).not.toContain("active:bg-muted");
  });
});

describe("자산 목록 줄 — 금액과 칩", () => {
  it("합계에서 뺀 줄은 금액을 회색으로 낮추고 이유를 칩 글자로 말한다", () => {
    const html = render({
      counted: false,
      chip: ["attention", "합계 제외 · 중복 확인 필요"],
    });
    expect(html).toContain("1,000원");
    expect(html).toContain("text-muted-foreground font-normal");
    expect(html).toContain("합계 제외 · 중복 확인 필요");
  });
  it("금액이 없으면 직접 입력은 '미입력', 연결 계좌는 넘겨받은 글자를 쓴다", () => {
    expect(render({ amount: null })).toContain("미입력");
    expect(render({ amount: null, emptyText: "확인 중" })).toContain("확인 중");
  });
});
