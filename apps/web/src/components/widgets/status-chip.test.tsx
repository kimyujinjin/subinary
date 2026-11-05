/**
 * 상태 표시는 하나의 모양이다(2026-11-05 HIG 검수). 예전에는 같은 '확인 필요'가 목록에서는 옅은 칩,
 * 상세·할 일에서는 꽉 찬 배지('확인필요')로 보였다. StatusBadge는 이제 StatusChip을 그린다.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StatusBadge } from "./status-badge";
import { StatusChip } from "./status-chip";

describe("StatusChip", () => {
  it("높이는 최소값만 둔다 — 글자를 키워도 칩 밖으로 넘치지 않는다", () => {
    const html = renderToStaticMarkup(<StatusChip>확인 필요</StatusChip>);
    expect(html).toContain("min-h-5");
    expect(html).not.toMatch(/[\s"]h-5[\s"]/);
  });
});

describe("StatusBadge", () => {
  it("StatusChip과 같은 마크업을 그린다(꽉 찬 배지가 아니다)", () => {
    expect(renderToStaticMarkup(<StatusBadge status="pending_review" />)).toBe(
      renderToStaticMarkup(<StatusChip tone="attention">확인 필요</StatusChip>)
    );
    expect(
      renderToStaticMarkup(<StatusBadge status="duplicate_suspected" />)
    ).toBe(
      renderToStaticMarkup(<StatusChip tone="error">중복 의심</StatusChip>)
    );
    expect(
      renderToStaticMarkup(<StatusBadge status="partially_cancelled" />)
    ).toBe(
      renderToStaticMarkup(<StatusChip tone="attention">부분 취소</StatusChip>)
    );
    expect(renderToStaticMarkup(<StatusBadge status="cancelled" />)).toBe(
      renderToStaticMarkup(<StatusChip tone="neutral">취소</StatusChip>)
    );
    expect(
      renderToStaticMarkup(<StatusBadge status="cancelled" />)
    ).not.toContain('data-slot="badge"');
  });

  it("상태 이름은 띄어 쓴다", () => {
    for (const status of [
      "pending_review",
      "duplicate_suspected",
      "partially_cancelled",
    ]) {
      const html = renderToStaticMarkup(<StatusBadge status={status} />);
      expect(html).not.toMatch(/확인필요|중복의심|부분취소/);
    }
  });

  it("톤을 바꿔 불러도 칩 색조로 옮겨진다", () => {
    expect(
      renderToStaticMarkup(
        <StatusBadge status="excluded" label="제외됨" tone="neutral" />
      )
    ).toBe(
      renderToStaticMarkup(<StatusChip tone="neutral">제외됨</StatusChip>)
    );
    expect(
      renderToStaticMarkup(<StatusBadge status="x" label="새로" tone="info" />)
    ).toBe(renderToStaticMarkup(<StatusChip tone="pending">새로</StatusChip>));
    expect(
      renderToStaticMarkup(
        <StatusBadge status="x" label="좋아요" tone="success" />
      )
    ).toBe(renderToStaticMarkup(<StatusChip tone="ok">좋아요</StatusChip>));
  });

  it("기본 상태(승인·활성)는 그리지 않고, 라벨을 주면 그린다", () => {
    expect(renderToStaticMarkup(<StatusBadge status="approved" />)).toBe("");
    expect(renderToStaticMarkup(<StatusBadge status="active" />)).toBe("");
    expect(
      renderToStaticMarkup(<StatusBadge status="active" label="정기 결제" />)
    ).toContain("정기 결제");
  });
});
