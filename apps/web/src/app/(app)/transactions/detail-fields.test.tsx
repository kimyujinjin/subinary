/**
 * 거래 상세 정보·설정 줄(2026-11-05 사용자 지적: '분류' 아래 드롭다운이 입력 양식처럼 쌓여 보기 안 좋았다).
 * 바꾸는 줄은 이름 · 값 · › 한 줄이고, 누르면 선택 시트가 열린다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FieldList, FieldRow, PickerOptionList } from "./detail-fields";

describe("거래 상세 정보·설정 줄", () => {
  it("바꾸는 줄은 이름·값·화살표가 한 줄인 버튼이고, 읽기 전용 줄은 버튼이 아니다", () => {
    const html = renderToStaticMarkup(
      <FieldList>
        <FieldRow label="결제자" value="수빈" />
        <FieldRow label="카테고리" value="카페" onClick={() => undefined} />
      </FieldList>
    );
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('aria-haspopup="dialog"');
    const button = html.slice(
      html.indexOf("<button"),
      html.indexOf("</button>")
    );
    expect(button).toContain("카테고리");
    expect(button).toContain("카페");
    expect(button).toContain("<svg");
    expect(html).not.toContain("<select");
  });

  it("값이 비었으면 흐리게, 덧붙인 안내는 줄 아래에 작게 보인다", () => {
    const html = renderToStaticMarkup(
      <FieldRow
        label="카드"
        value="카드 미연결"
        muted
        onClick={() => undefined}
      >
        카드에 연결하면 공개 범위가 카드 설정을 따라가요.
      </FieldRow>
    );
    expect(html).toMatch(/text-muted-foreground"?[^>]*>카드 미연결/);
    expect(html).toContain("text-caption");
    expect(html).toContain("카드에 연결하면");
  });

  it("선택지 목록은 지금 값만 선택됨·체크로 표시한다", () => {
    const html = renderToStaticMarkup(
      <PickerOptionList
        label="카테고리"
        options={[
          { value: "a", label: "카페" },
          { value: "b", label: "식비" },
        ]}
        value="b"
        onPick={() => undefined}
      />
    );
    expect(html).toContain('role="listbox"');
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    const selected = html.slice(html.indexOf('aria-selected="true"'));
    expect(selected.slice(0, selected.indexOf("</button>"))).toContain("식비");
    expect(html.match(/<svg/g)).toHaveLength(1);
  });

  it("거래 상세는 드롭다운을 쌓지 않고 이 줄과 선택 시트를 쓴다", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/(app)/transactions/page.tsx"),
      "utf8"
    );
    const start = source.indexOf("function TransactionDetailDialog(");
    const end = source.indexOf("\nfunction ", start + 1);
    const detail = source.slice(start, end);
    expect(detail).toContain("<FieldList>");
    expect(detail.match(/<PickerSheet\b/g)).toHaveLength(3);
    for (const id of ["detail-category", "detail-visibility", "detail-card"]) {
      expect(detail).not.toContain(`id="${id}"`);
    }
  });
});
