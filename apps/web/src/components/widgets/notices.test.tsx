/**
 * 화면 안 알림 줄(InlineNotice)과 불러오기 실패(ErrorState) — 화면마다 따로 짜던 오류·안내 마크업을 모은다.
 */
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ErrorState } from "./error-state";
import { InlineNotice } from "./inline-notice";

describe("InlineNotice", () => {
  it("오류만 바로 읽어 주는 alert이고, 완료·안내는 status다", () => {
    expect(
      renderToStaticMarkup(
        <InlineNotice tone="error">저장하지 못했어요</InlineNotice>
      )
    ).toMatch(/^<div[^>]*role="alert"/);
    expect(
      renderToStaticMarkup(
        <InlineNotice tone="success">저장했어요</InlineNotice>
      )
    ).toMatch(/^<div[^>]*role="status"/);
    expect(
      renderToStaticMarkup(<InlineNotice>매일 밤 정리해요</InlineNotice>)
    ).toMatch(/^<div[^>]*role="status"/);
  });

  it("오류는 위험 색과 경고 아이콘이고, 아이콘은 읽지 않는다", () => {
    const html = renderToStaticMarkup(
      <InlineNotice tone="error" id="amount-error">
        금액을 다시 확인해 주세요
      </InlineNotice>
    );
    expect(html).toContain('id="amount-error"');
    expect(html).toContain("text-destructive");
    expect(html).toContain("lucide-circle-alert");
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).toContain("금액을 다시 확인해 주세요");
  });

  it("옛 글자 크기·모서리를 쓰지 않는다", () => {
    const html = renderToStaticMarkup(
      <InlineNotice tone="info">안내</InlineNotice>
    );
    expect(html).toContain("text-body");
    expect(html).toContain("rounded-control");
    expect(html).not.toMatch(/text-(xs|sm|lg)\b|text-\[|rounded-(md|lg|xl)\b/);
  });
});

describe("ErrorState", () => {
  it("원인 한 줄(alert)과 '다시 불러오기' 약한 버튼", () => {
    const html = renderToStaticMarkup(
      <ErrorState
        message="알림 설정을 불러오지 못했어요"
        onRetry={() => undefined}
      />
    );
    expect(html).toMatch(
      /<p[^>]*role="alert"[^>]*>알림 설정을 불러오지 못했어요<\/p>/
    );
    const button = /<button[^>]*>다시 불러오기<\/button>/.exec(html);
    expect(button).not.toBeNull();
    // 약한 버튼 — 채움(bg-primary 단색)이 아니다. 화면의 채움 버튼 자리를 빼앗지 않는다.
    expect(button![0]).toContain("bg-primary/10");
    expect(button![0]).not.toMatch(/\bbg-primary\b(?!\/)/);
    expect(button![0]).not.toContain('disabled=""');
  });

  it("다시 불러오는 중이면 버튼을 잠근다", () => {
    const html = renderToStaticMarkup(
      <ErrorState
        message="불러오지 못했어요"
        onRetry={() => undefined}
        retrying
      />
    );
    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).toContain('aria-busy="true"');
  });

  it("버튼을 누르면 onRetry를 부른다", () => {
    const onRetry = vi.fn();
    const tree = ErrorState({
      message: "불러오지 못했어요",
      onRetry,
    }) as ReactElement<{
      children: ReactElement<{ onClick?: () => void }>[];
    }>;
    const button = tree.props.children[1]!;
    button.props.onClick?.();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("start 정렬은 페이지 머리 아래 짧은 블록이다", () => {
    const html = renderToStaticMarkup(
      <ErrorState
        message="불러오지 못했어요"
        onRetry={() => undefined}
        align="start"
      />
    );
    expect(html).toMatch(/^<div[^>]*class="[^"]*items-start/);
    expect(html).not.toContain("w-full");
  });
});
