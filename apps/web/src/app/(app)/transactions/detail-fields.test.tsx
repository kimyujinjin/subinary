/**
 * 거래 상세 정보·설정 줄(2026-11-05 사용자 지적: '분류' 아래 드롭다운이 입력 양식처럼 쌓여 보기 안 좋았다).
 * 값을 고르는 줄은 '이름 · 값 · ›' 한 줄이고, 누르면 그 자리 아래로 드롭다운이 펼쳐진다(시트가 아니다).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FieldList, FieldRow } from "./detail-fields";

const options = [
  { value: "a", label: "카페" },
  { value: "b", label: "식비" },
];

describe("거래 상세 정보·설정 줄", () => {
  it("값을 고르는 줄은 드롭다운 버튼, 창을 여는 줄은 창 버튼, 읽기 전용 줄은 버튼이 아니다", () => {
    const html = renderToStaticMarkup(
      <FieldList>
        <FieldRow label="결제자" value="수빈" />
        <FieldRow
          label="카테고리"
          value="카페"
          menu={{
            label: "카테고리",
            options,
            value: "a",
            onSelect: () => undefined,
          }}
        />
        <FieldRow label="메모" value="남기기" muted onClick={() => undefined} />
      </FieldList>
    );
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html.match(/aria-haspopup="menu"/g)).toHaveLength(1);
    expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(1);
    const menuButton = html.slice(
      html.indexOf("<button"),
      html.indexOf("</button>")
    );
    expect(menuButton).toContain("카테고리");
    expect(menuButton).toContain("카페");
    expect(menuButton).toContain("<svg");
    // 설정 앱 위계: 이름은 기본 글자색, 값은 회색. 값 고르기 줄은 ⌃⌄, 다른 창을 여는 줄은 ›.
    expect(menuButton).toContain("lucide-chevrons-up-down");
    expect(menuButton).toMatch(/text-foreground[^"]*"[^>]*>카테고리/);
    expect(menuButton).toMatch(/text-muted-foreground[^"]*"[^>]*>카페/);
    const dialogButton = html.slice(html.lastIndexOf("<button"));
    expect(dialogButton).toContain("lucide-chevron-right");
    expect(html).not.toContain("<select");
  });

  it("값이 비었으면 흐리게, 덧붙인 안내는 줄 아래에 작게 보인다", () => {
    const html = renderToStaticMarkup(
      <FieldRow
        label="카드"
        value="카드 미연결"
        muted
        menu={{
          label: "카드",
          options,
          value: null,
          onSelect: () => undefined,
        }}
      >
        카드에 연결하면 공개 범위가 카드 설정을 따라가요.
      </FieldRow>
    );
    expect(html).toMatch(/text-muted-foreground"?[^>]*>카드 미연결/);
    expect(html).toContain("text-caption");
    expect(html).toContain("카드에 연결하면");
  });

  it("거래 상세는 바텀 시트이고, 값 고르기는 드롭다운 줄 세 개다 — 쌓인 드롭다운·선택 시트는 없다", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/(app)/transactions/page.tsx"),
      "utf8"
    );
    const start = source.indexOf("function TransactionDetailDialog(");
    const end = source.indexOf("\nfunction ", start + 1);
    const detail = source.slice(start, end);
    expect(detail).toContain('layout="sheet"');
    expect(detail).toContain("<FieldList>");
    expect(detail.match(/\bmenu=\{\{/g)).toHaveLength(3);
    expect(detail).not.toContain("PickerSheet");
    for (const id of ["detail-category", "detail-visibility", "detail-card"]) {
      expect(detail).not.toContain(`id="${id}"`);
    }
  });
});
