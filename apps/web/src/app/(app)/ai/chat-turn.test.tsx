import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ChatTurn } from "./chat-turn";
import type { Turn } from "./finance-turn";

const base: Turn = { id: 1, at: 0, question: "이번 달 식비 얼마 썼어?" };

function render(turn: Turn, busy = false): string {
  return renderToStaticMarkup(
    <ChatTurn turn={turn} busy={busy} onAsk={vi.fn()} onRetry={vi.fn()} />
  );
}

describe("AI 도우미 — 문답 한 턴", () => {
  it("실패하면 말풍선이 원인을 말하고 바로 아래에 '다시 묻기'가 있다", () => {
    const html = render({
      ...base,
      answer: "답을 가져오지 못했어요.",
      error: true,
    });
    expect(html).toMatch(/role="alert"[^>]*>답을 가져오지 못했어요\./);
    expect(html).toMatch(/<button[^>]*>.*다시 묻기<\/button>/);
  });

  it("다른 질문을 기다리는 동안에는 '다시 묻기'를 잠근다", () => {
    const html = render({ ...base, answer: "실패", error: true }, true);
    const retry = html.match(
      /<button[^>]*>(?:(?!<\/button>).)*다시 묻기<\/button>/
    )?.[0];
    expect(retry).toContain('disabled=""');
  });

  it("거부는 실패가 아니다 — 빨간 말풍선도 '다시 묻기'도 없이 대신 물어볼 질문을 준다", () => {
    const html = render({
      ...base,
      answer: "아직 그 질문에는 답하지 못해요.",
      refused: true,
      suggestions: ["이번 달 총 지출 얼마야?"],
    });
    expect(html).not.toContain("다시 묻기");
    expect(html).not.toContain("text-destructive");
    expect(html).toContain("이번 달 총 지출 얼마야?");
  });

  it("답을 기다리는 동안에는 상태 한 줄만 보인다", () => {
    const html = render(base);
    expect(html).toContain("살펴보고 있어요…");
    expect(html).not.toContain("다시 묻기");
  });
});
