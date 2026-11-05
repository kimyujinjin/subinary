"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · AI 도우미 (/ai)
 *
 * 가계부 질문에 답하는 대화 화면이다(`POST /v1/ai/finance-query`).
 * 2026-11 리뉴얼에서 '업무 기억'(Slack 기록 질의) 범위를 화면에서 걷어냈다 — 가족
 * 가계부 메뉴에서 쓰이지 않는 동선이었다. 서버 API는 그대로 남아 있다.
 *
 * ## 정직함이 이 화면의 설계 원칙이다
 * 1) **못 하는 걸 할 수 있다고 말하지 않는다.** 예전 빈 상태는 "무엇이든
 *    물어보세요"였는데 실제로는 지출 집계만 답한다. 카피를 실제 능력으로 줄였다.
 * 2) **미지원 질문에 다른 답을 대신 주지 않는다.** 서버가 `refused`를 주면 그대로
 *    "아직 못 답해요 + 이런 건 물어보실 수 있어요"로 보여 준다. 오류 스타일(빨강)로
 *    그리지 않는다 — 거부는 실패가 아니라 정직한 답이다.
 * 3) **답의 근거를 함께 보여 준다.** 서버가 집계한 행(`data.items`)을 답 아래에 최대
 *    5줄 붙인다 — "어디에 얼마"를 직접 확인할 수 있어야 숫자를 믿는다.
 *
 * 레이아웃: 문서 흐름(main pt/pb)에 의존하는 높이 calc 대신 fixed 패널로
 * 헤더 아래~탭바 위를 정확히 채운다(globals.css의 --app-header-h/--app-tabbar-h와
 * 단일 출처). 키보드가 열리면 네이티브/Android/Chrome은 뷰포트 자체가 줄고
 * (resize:native / adjustResize / resizes-content) 탭바는 kb-open으로 접혀
 * 입력바가 키보드에 밀착된다. iOS 사파리 웹만 뷰포트가 안 줄므로 --kb-inset
 * 폴백(native.ts)으로 패널 하단을 키보드 위로 끌어올린다.
 * 답변 금액은 서버 SQL 집계 근거이며 LLM이 지어내지 않는다(백엔드 계약).
 * ------------------------------------------------------------------------- */
import { useMutation } from "@tanstack/react-query";
import { Loader2, Send, Sparkles } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { toast } from "sonner";

import type { FinanceQueryItem } from "@family/contracts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Money, PageBackHeader } from "@/components/widgets";
import {
  aiChatStorageKey,
  loadAiChat,
  saveAiChat,
} from "@/lib/ai-chat-history";
import { ApiError, api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useHousehold } from "@/lib/household-context";
import { cn } from "@/lib/utils";

import { financeTurn, type Turn } from "./finance-turn";

/**
 * 대화 저장 범위. 두 범위가 있던 때의 금융 쪽 키를 그대로 써서, 이미 저장된 대화가
 * 업데이트 뒤에도 이어진다(lib/ai-chat-history.ts의 `(가족, 범위)` 키).
 */
const CHAT_SCOPE = "finance";

/** 화면에서 걷어낸 '업무 기억' 범위의 저장 키. 기기에 남은 대화를 지우는 데만 쓴다. */
const RETIRED_CHAT_SCOPE = "work";

/**
 * 추천 질문 — 전부 실제로 답할 수 있는 형태만 둔다.
 * (예전에 있던 "지난달이랑 비교해줘"는 기간 비교 기능이 없어 지금은 거부된다.
 * 답하지 못할 질문을 화면이 권하면 사용자는 두 번 속는다.)
 */
const FINANCE_SUGGESTIONS = [
  "이번 달 총 지출 얼마야?",
  "이번 달 식비 얼마 썼어?",
  "이번 달 어디서 제일 많이 썼어?",
  "지난달 카페 얼마 썼어?",
];

/** 이 거리(px) 이내면 '바닥에 붙어 있음'으로 간주 — 자동 스크롤 유지 판단 기준. */
const NEAR_BOTTOM_PX = 80;

/** 저장 키가 어긋난 순간에 쓰는 고정 빈 배열(매 렌더 새 배열이면 effect가 헛돈다). */
const EMPTY_TURNS: Turn[] = [];

export default function AiPage() {
  const { authedFetch } = useAuth();
  const { householdId } = useHousehold();
  const [input, setInput] = useState("");

  /* --- 대화 보존 -----------------------------------------------------------
   * 대화는 가족 단위로 로컬에 남는다(lib/ai-chat-history.ts). 상태에 **어느 키의
   * 대화인지**를 함께 들고 있는 이유: 가족이 바뀌면 로드 effect가 새 대화를 넣기 전에
   * 저장 effect가 먼저 돌 수 있는데, 그때 이전 가족의 문답을 새 키에 덮어쓰면 다른
   * 가계부의 답변이 섞인다. 키가 어긋나면 저장도 화면 표시도 하지 않는다. */
  const historyKey = householdId
    ? aiChatStorageKey(householdId, CHAT_SCOPE)
    : null;
  const [chat, setChat] = useState<{ key: string | null; turns: Turn[] }>({
    key: null,
    turns: [],
  });
  const turns = useMemo(
    () => (chat.key === historyKey ? chat.turns : EMPTY_TURNS),
    [chat, historyKey],
  );
  const setTurns = useCallback(
    (updater: (prev: Turn[]) => Turn[]) => {
      setChat((prev) => ({
        key: historyKey,
        turns: updater(prev.key === historyKey ? prev.turns : []),
      }));
    },
    [historyKey],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);
  // 바닥 고정 여부는 DOM이 자라기 *전* 상태로 판단해야 하므로 onScroll로 기록해 둔다.
  // (effect 시점엔 새 말풍선이 이미 붙어 scrollHeight가 커진 뒤라 오판한다.)
  const atBottomRef = useRef(true);
  const prevTurnCount = useRef(0);

  const financeMutation = useMutation({
    mutationFn: (question: string) =>
      authedFetch((token) =>
        api.ai.financeQuery(token, {
          householdId: householdId as string,
          question,
        }),
      ),
  });

  const pending = financeMutation.isPending;

  // 진입/가족 전환 → 저장된 대화 복원. id는 화면 안에서만 쓰는 번호라 복원한
  // 최대값 다음부터 이어 준다(같은 id가 두 번 나오면 말풍선이 잘못 재사용된다).
  //
  // 답이 없는 문답은 버린다: 요청 중에 화면을 떠난 것이라 이어받을 요청이 없고,
  // 복원하면 영원히 '살펴보고 있어요…'로 남는다.
  useEffect(() => {
    if (!historyKey) return;
    const restored = loadAiChat<Turn>(historyKey, Date.now()).filter(
      (t) => t.answer !== undefined,
    );
    nextId.current = restored.reduce((max, t) => Math.max(max, t.id), 0) + 1;
    setChat({ key: historyKey, turns: restored });
  }, [historyKey]);

  // 걷어낸 '업무 기억' 대화는 다시 열 화면이 없다 — 이 기기에 남겨 두지 않는다
  // (빈 목록을 저장하면 키가 지워진다).
  useEffect(() => {
    if (!householdId) return;
    saveAiChat(aiChatStorageKey(householdId, RETIRED_CHAT_SCOPE), [], Date.now());
  }, [householdId]);

  // 대화가 바뀔 때마다 저장. 키가 어긋난 커밋(전환 직후 1프레임)은 건너뛴다 —
  // 여기서 쓰면 이전 가족의 답변이 새 키에 들어간다.
  useEffect(() => {
    if (!historyKey || chat.key !== historyKey) return;
    saveAiChat(historyKey, chat.turns, Date.now());
  }, [historyKey, chat]);

  // 새 질문 추가 → 무조건 바닥으로(사용자 액션). 답변 갱신 → 사용자가 위로
  // 스크롤해 읽는 중이면 강제로 끌어내리지 않고, 바닥 근처였을 때만 따라간다.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const added = turns.length > prevTurnCount.current;
    prevTurnCount.current = turns.length;
    if (added || atBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [turns]);

  // 키보드 개폐 등으로 스크롤 영역 높이가 변할 때 바닥에 있었다면 바닥 유지.
  // (네이티브 resize·adjustResize·resizes-content 모두 컨테이너 리사이즈로 관측됨)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (atBottomRef.current) el.scrollTo({ top: el.scrollHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 자동 포커스는 물리 키보드 환경(데스크톱)에서만 — 터치 기기에서 진입 즉시
  // 소프트 키보드가 화면 절반을 덮는 것을 피한다(추천 질문이 첫 행동 동선).
  useEffect(() => {
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      inputRef.current?.focus();
    }
  }, []);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || pending || !householdId) return;

    const id = nextId.current++;
    setTurns((prev) => [...prev, { id, at: Date.now(), question: q }]);
    setInput("");
    try {
      const patch = financeTurn(await financeMutation.mutateAsync(q));
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : "답변을 가져오지 못했어요.";
      toast.error(msg);
      setTurns((prev) =>
        prev.map((t) => (t.id === id ? { ...t, answer: msg, error: true } : t)),
      );
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    ask(input);
  }

  const empty = turns.length === 0;

  return (
    // fixed 패널: 헤더 아래(top)~탭바 위(bottom)를 채운다. 문서 흐름 밖이라
    // main 패딩·보더 1px 오차 등으로 페이지 전체가 스크롤되는 문제가 없다.
    // bottom의 max(): iOS 사파리 웹에서만 --kb-inset(키보드 높이)이 탭바 높이를
    // 이겨 입력바를 키보드 위로 올린다. 그 외 환경에선 --kb-inset=0.
    <div
      // 당겨서 새로고침 제외 — 이 패널은 fixed라 조상 transform이 걸리면
      // 기준이 뷰포트에서 그 조상으로 바뀌어 헤더/탭바 정렬이 깨진다.
      data-no-pull-refresh
      className="bg-background fixed inset-x-0 top-[var(--app-header-h)] bottom-[max(var(--app-tabbar-h),var(--kb-inset))] z-10 lg:bottom-0 lg:left-52"
    >
      <div className="mx-auto flex h-full w-full max-w-2xl flex-col px-(--page-px)">
        <div className="shrink-0 pt-4 lg:pt-6">
          <PageBackHeader title="AI 도우미" backHref="/more" />
        </div>

        {/* 대화 영역(스크롤) — overscroll-contain: 끝 바운스가 바디로 번지지 않게 */}
        <div
          ref={scrollRef}
          onScroll={() => {
            const el = scrollRef.current;
            if (!el) return;
            atBottomRef.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
          }}
          className="flex-1 overflow-y-auto overscroll-contain pb-4"
        >
          {empty ? (
            // min-h-full(h-full 아님): 키보드로 뷰포트가 줄어 콘텐츠가 넘치면
            // 래퍼가 자라면서 정상 스크롤 — h-full+center는 상단이 잘려 도달 불가.
            <div className="flex min-h-full flex-col items-center justify-center gap-5 py-6 text-center">
              <span
                aria-hidden="true"
                className="bg-accent text-accent-foreground flex size-14 items-center justify-center rounded-full"
              >
                <Sparkles className="size-7" />
              </span>
              <div className="flex flex-col gap-1">
                {/* 카피는 실제 능력까지만 — "무엇이든"은 지키지 못하는 약속이었다. */}
                <h2 className="text-heading">가계부에 대해 물어보세요</h2>
                <p className="text-muted-foreground text-body">
                  기간·카테고리·가맹점별로 쓴 돈을 알려드려요.
                </p>
              </div>
              <div className="flex w-full max-w-sm flex-col gap-2">
                {FINANCE_SUGGESTIONS.map((s) => (
                  <SuggestionButton key={s} text={s} onPick={ask} />
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4 py-4">
              {turns.map((t) => (
                <div key={t.id} className="flex flex-col gap-2">
                  {/* 질문 — 오른쪽 */}
                  <div className="flex justify-end">
                    <div className="bg-primary text-primary-foreground text-body max-w-[85%] rounded-card px-4 py-2.5">
                      {t.question}
                    </div>
                  </div>
                  {/* 답변 — 왼쪽 */}
                  <div className="flex justify-start">
                    {t.answer === undefined ? (
                      <div
                        role="status"
                        className="bg-muted text-muted-foreground text-body flex items-center gap-2 rounded-card px-4 py-2.5"
                      >
                        <Loader2 className="size-4 animate-spin" /> 살펴보고
                        있어요…
                      </div>
                    ) : (
                      // 거부(refused)는 오류가 아니다 — 빨간 스타일을 쓰지 않는다.
                      <div
                        className={cn(
                          "text-body max-w-[85%] rounded-card px-4 py-2.5 whitespace-pre-wrap",
                          t.error
                            ? "bg-destructive/10 text-destructive"
                            : "bg-muted",
                        )}
                      >
                        {t.answer}
                      </div>
                    )}
                  </div>

                  {/* 답의 근거 — 서버가 집계한 행 그대로(어디에 · 몇 건 · 얼마). */}
                  {t.rows && t.rows.length > 0 ? (
                    <GroundingRows rows={t.rows} />
                  ) : null}

                  {/* 거부 시 "대신 이런 건 물어보실 수 있어요" */}
                  {t.refused && t.suggestions && t.suggestions.length > 0 ? (
                    <div className="flex flex-wrap gap-2 pl-1">
                      {t.suggestions.map((s) => (
                        <SuggestionChip key={s} text={s} onPick={ask} />
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 입력 — 패널 하단(탭바/키보드에 밀착).
            Input은 전송 중에도 disabled하지 않는다: 포커스가 끊기면 모바일
            키보드가 매 질문마다 닫혔다 열린다(중복 전송은 ask()의 pending
            가드 + submit 버튼 disabled가 막는다). h-11/size-11: 터치 타깃
            44px 통일. 포커스 줌 방어(16px)는 globals.css의 pointer:coarse
            전역 규칙이 담당. */}
        <form
          onSubmit={onSubmit}
          className="bg-background flex items-center gap-2 py-3"
        >
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="지출에 대해 물어보세요"
            aria-label="질문"
            enterKeyHint="send"
            className="h-11"
          />
          <Button
            type="submit"
            size="icon"
            className="size-11"
            disabled={pending || input.trim() === "" || !householdId}
            aria-label="질문 보내기"
            // 버튼 탭이 input의 포커스를 뺏어 키보드가 닫히는 것 방지(Android).
            onPointerDown={(e) => e.preventDefault()}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 작은 조각                                                                    */
/* -------------------------------------------------------------------------- */

/** 근거 행 목록 — 답 말풍선 아래의 작은 표(이름 · 건수 · 금액). */
function GroundingRows({ rows }: { rows: FinanceQueryItem[] }) {
  return (
    <ul aria-label="답의 근거" className="flex max-w-[85%] flex-col gap-1.5 pl-1">
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

function SuggestionButton({
  text,
  onPick,
}: {
  text: string;
  onPick: (q: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(text)}
      className="bg-muted hover:bg-muted/70 text-body rounded-control px-4 py-3 text-left transition-colors active:scale-[0.99]"
    >
      {text}
    </button>
  );
}

function SuggestionChip({
  text,
  onPick,
}: {
  text: string;
  onPick: (q: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(text)}
      className="bg-muted hover:bg-muted/70 text-caption min-h-9 rounded-full px-3 transition-colors active:scale-[0.99]"
    >
      {text}
    </button>
  );
}
