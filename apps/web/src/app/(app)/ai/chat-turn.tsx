/* ---------------------------------------------------------------------------
 * AI 도우미 — 문답 한 턴(질문 말풍선 · 답 말풍선 · 근거 행 · 대신 물어볼 질문).
 *
 * 화면(page.tsx)에서 떼어 둔 이유: 말풍선이 어떤 상태에서 무엇을 보이는지(실패하면 '다시 묻기')를
 * 테스트로 고정한다(Next 페이지 파일은 default 외의 export를 둘 수 없다).
 *
 * 실패는 말풍선 한 곳에서만 말한다. 예전에는 토스트와 빨간 말풍선이 같은 말을 두 번 했고, 같은
 * 질문을 다시 보낼 길이 없었다(2026-11-05 HIG 검수).
 * ------------------------------------------------------------------------- */
import { Loader2, RotateCcw } from "lucide-react";

import type { FinanceQueryItem } from "@family/contracts";

import { Button, touchTarget } from "@/components/ui/button";
import { Money } from "@/components/widgets";
import { cn } from "@/lib/utils";

import type { Turn } from "./finance-turn";

export function ChatTurn({
  turn,
  busy,
  onAsk,
  onRetry,
}: Readonly<{
  turn: Turn;
  /** 다른 질문을 기다리는 중이면 '다시 묻기'·추천 질문을 잠근다(한 번에 하나만 보낸다). */
  busy: boolean;
  onAsk: (question: string) => void;
  /** 실패한 이 턴을 같은 질문으로 다시 보낸다. */
  onRetry: (turn: Turn) => void;
}>) {
  return (
    <div className="flex flex-col gap-2">
      {/* 질문 — 오른쪽 */}
      <div className="flex justify-end">
        <div className="bg-primary text-primary-foreground text-body max-w-[85%] rounded-card px-4 py-2.5">
          {turn.question}
        </div>
      </div>
      {/* 답변 — 왼쪽 */}
      <div className="flex justify-start">
        {turn.answer === undefined ? (
          <div
            role="status"
            className="bg-muted text-muted-foreground text-body flex items-center gap-2 rounded-card px-4 py-2.5"
          >
            <Loader2 className="size-4 animate-spin" /> 살펴보고 있어요…
          </div>
        ) : (
          // 거부(refused)는 오류가 아니다 — 빨간 스타일을 쓰지 않는다.
          <div
            role={turn.error ? "alert" : undefined}
            className={cn(
              "text-body max-w-[85%] rounded-card px-4 py-2.5 whitespace-pre-wrap",
              turn.error ? "bg-destructive/10 text-destructive" : "bg-muted"
            )}
          >
            {turn.answer}
          </div>
        )}
      </div>

      {/* 실패 — 원인(말풍선) 바로 아래에 할 일 하나. */}
      {turn.error ? (
        <div className="pl-1">
          <Button
            type="button"
            variant="weak"
            size="sm"
            disabled={busy}
            onClick={() => onRetry(turn)}
          >
            <RotateCcw /> 다시 묻기
          </Button>
        </div>
      ) : null}

      {/* 답의 근거 — 서버가 집계한 행 그대로(어디에 · 몇 건 · 얼마). */}
      {turn.rows && turn.rows.length > 0 ? (
        <GroundingRows rows={turn.rows} />
      ) : null}

      {/* 거부 시 "대신 이런 건 물어보실 수 있어요" */}
      {turn.refused && turn.suggestions && turn.suggestions.length > 0 ? (
        <div className="flex flex-wrap gap-2 pl-1">
          {turn.suggestions.map((s) => (
            <SuggestionChip key={s} text={s} disabled={busy} onPick={onAsk} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 근거 행 목록 — 답 말풍선 아래의 작은 표(이름 · 건수 · 금액). */
function GroundingRows({ rows }: { rows: FinanceQueryItem[] }) {
  return (
    <ul
      aria-label="답의 근거"
      className="flex max-w-[85%] flex-col gap-1.5 pl-1"
    >
      {rows.map((row, index) => (
        <li
          key={`${index}-${row.label}`}
          className="text-caption flex min-w-0 items-center gap-2"
        >
          <span className="min-w-0 flex-1 truncate">{row.label}</span>
          <span className="text-muted-foreground shrink-0 tabular-nums">
            {row.count}건
          </span>
          <Money amount={row.net} className="shrink-0 font-semibold" />
        </li>
      ))}
    </ul>
  );
}

/** 대신 물어볼 질문 칩 — 보이는 알약은 36px, 누르는 칸은 44px(touchTarget). */
function SuggestionChip({
  text,
  disabled,
  onPick,
}: {
  text: string;
  disabled: boolean;
  onPick: (q: string) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(text)}
      className={cn(
        "bg-muted hover:bg-muted/70 active:bg-muted/50 text-caption min-h-9 rounded-full px-3 transition-colors disabled:opacity-40",
        touchTarget
      )}
    >
      {text}
    </button>
  );
}
