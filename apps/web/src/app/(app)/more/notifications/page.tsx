"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 알림 설정 (/more/notifications)
 *
 * user 스코프 알림 선호(notification_preferences)를 편집한다. **바꾸면 바로 저장한다** —
 * 스위치는 즉시, 금액·시간 입력은 입력이 멈추고 0.6초 뒤(전체 대체 PUT, 한 번에 하나씩).
 * 저장 상태는 헤더 오른쪽 한 줄로 알리고, 실패하면 알림과 '다시 시도'를 띄운다(입력값은
 * 지우지 않는다). 화면을 떠나면 기다리던 입력을 바로 보낸다.
 *
 * 선호는 사용자 단위라 **내 모든 기기**에 적용된다. 끄는 것은 푸시뿐이고 알림함 기록은
 * 남는다(worker가 선호를 보기 전에 이력을 저장한다). 종류 이름·설명은 안드로이드 알림
 * 채널과 같은 문구다 — 시스템 설정에서 찾는 이름과 같아야 한다.
 *
 * 무음 시간대는 분(0~1439)으로 저장하고 HH:MM으로 다룬다. 시작=끝은 발송 쪽이 "무음 없음"
 * 으로 읽으므로 화면과 계약이 함께 막는다. 이미 저장된 시작=끝은 꺼진 것으로 보여 준다(같은
 * 뜻이다). 고치는 중인 무음 시간은 보내지 않고 마지막으로 저장된 값을 그대로 둔다.
 * ------------------------------------------------------------------------- */
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { toast } from "sonner";

import {
  notificationKindSchema,
  type NotificationKind,
  type NotificationPreferencesUpdateRequest,
} from "@family/contracts";
import { NOTIFICATION_CHANNEL_META, NOTIFICATION_CHANNELS } from "@family/shared";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ErrorState, ListLoading, PageBackHeader } from "@/components/widgets";
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from "@/lib/queries";
import { cn } from "@/lib/utils";

import {
  draftFromServer,
  groupDigits,
  quietError,
  SaveQueue,
  toUpdateRequest,
  type NotificationSettingsDraft,
  type SaveState,
} from "./notification-settings";

/** 금액·시간 입력이 멈춘 뒤 저장까지 기다리는 시간. */
const INPUT_SAVE_DELAY_MS = 600;
/** 최소 금액 자릿수 상한(9억 원대) — 서버 정수 범위 안쪽. */
const MIN_AMOUNT_MAX_DIGITS = 9;

const CHANNEL_META = new Map(
  NOTIFICATION_CHANNEL_META.map((meta) => [meta.id, meta]),
);

/** 종류별 행 — 계약의 종류 순서 그대로, 이름·설명은 알림 채널 문구. */
const KIND_ROWS = notificationKindSchema.options.map((kind) => {
  const meta = CHANNEL_META.get(NOTIFICATION_CHANNELS[kind]);
  return { kind, name: meta?.name ?? kind, description: meta?.description };
});

/** 화면 수명 동안 하나의 저장 줄({@link SaveQueue}). 떠날 때 기다리던 입력을 보낸다. */
function useAutoSave(
  save: (body: NotificationPreferencesUpdateRequest) => Promise<unknown>,
) {
  const [state, setState] = useState<SaveState>("idle");
  const [queue] = useState(
    () =>
      new SaveQueue<NotificationPreferencesUpdateRequest>(save, setState, () =>
        toast.error("알림 설정을 저장하지 못했어요"),
      ),
  );
  useEffect(() => () => queue.flush(), [queue]);
  return { state, queue };
}

/** 헤더 오른쪽 저장 상태. 실패면 다시 시도 버튼이 된다. */
function SaveStatus({
  state,
  onRetry,
}: Readonly<{ state: SaveState; onRetry: () => void }>) {
  if (state === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="text-caption text-destructive -mr-2 inline-flex min-h-11 shrink-0 items-center px-2 font-medium"
      >
        다시 시도
      </button>
    );
  }
  return (
    <span
      role="status"
      className="text-caption text-muted-foreground shrink-0"
    >
      {state === "saving" ? "저장 중…" : state === "saved" ? "저장했어요" : ""}
    </span>
  );
}

/**
 * 스위치 행 — **행 전체가 눌린다**(label이 스위치 버튼을 가리킨다, 높이 56).
 * 끈 상태에서도 자기 값은 그대로 보여 준다: 푸시를 다시 켜면 보이던 대로 돌아온다.
 */
function SwitchRow({
  id,
  title,
  description,
  checked,
  disabled,
  nested,
  onCheckedChange,
}: Readonly<{
  id: string;
  title: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  nested?: boolean;
  onCheckedChange: (next: boolean) => void;
}>) {
  const descriptionId = description ? `${id}-description` : undefined;
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex min-h-14 items-center gap-4 py-3 pr-5",
        nested ? "pl-10" : "pl-5",
        disabled ? "cursor-not-allowed" : "active:bg-muted cursor-pointer",
      )}
    >
      <span
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-0.5",
          disabled && "opacity-50",
        )}
      >
        <span className="text-body">{title}</span>
        {description ? (
          <span
            id={descriptionId}
            className="text-caption text-muted-foreground"
          >
            {description}
          </span>
        ) : null}
      </span>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-label={title}
        aria-describedby={descriptionId}
      />
    </label>
  );
}

/**
 * 천 단위 쉼표가 붙는 금액 입력. 쉼표가 늘거나 줄어도 커서가 끝으로 튀지 않게, 커서 앞
 * 숫자 개수를 기억했다가 새 문자열에서 같은 자리로 돌려놓는다.
 */
function AmountInput({
  digits,
  onDigitsChange,
  ...props
}: Readonly<
  Omit<ComponentProps<typeof Input>, "value" | "onChange"> & {
    digits: string;
    onDigitsChange: (digits: string) => void;
  }
>) {
  const ref = useRef<HTMLInputElement>(null);
  const digitsBeforeCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const target = digitsBeforeCaret.current;
    digitsBeforeCaret.current = null;
    if (!el || target === null || document.activeElement !== el) return;
    let position = 0;
    let seen = 0;
    while (position < el.value.length && seen < target) {
      if (/\d/.test(el.value[position] ?? "")) seen += 1;
      position += 1;
    }
    el.setSelectionRange(position, position);
  });

  return (
    <Input
      {...props}
      ref={ref}
      inputMode="numeric"
      autoComplete="off"
      value={groupDigits(digits)}
      onChange={(event) => {
        const raw = event.target.value;
        const caret = event.target.selectionStart ?? raw.length;
        digitsBeforeCaret.current = raw.slice(0, caret).replace(/\D/g, "").length;
        onDigitsChange(
          raw
            .replace(/\D/g, "")
            .replace(/^0+(?=\d)/, "")
            .slice(0, MIN_AMOUNT_MAX_DIGITS),
        );
      }}
    />
  );
}

export default function NotificationSettingsPage() {
  const { data, isLoading, isError, isFetching, refetch } =
    useNotificationPreferences();
  const update = useUpdateNotificationPreferences();
  const saver = useAutoSave(update.mutateAsync);
  const { queue } = saver;
  // 처음 바꾸는 순간부터는 이 화면의 값이 기준이다(뒤에서 다시 받아 와도 입력을 덮지 않는다).
  const [draft, setDraft] = useState<NotificationSettingsDraft | null>(null);
  const view = draft ?? (data ? draftFromServer(data) : null);

  useEffect(() => {
    if (data && draft === null) {
      queue.markSaved(toUpdateRequest(draftFromServer(data), data));
    }
  }, [data, draft, queue]);

  function change(patch: Partial<NotificationSettingsDraft>, delayMs = 0) {
    if (!view) return;
    const next = { ...view, ...patch };
    setDraft(next);
    queue.schedule(toUpdateRequest(next, data), delayMs);
  }

  function toggleKind(kind: NotificationKind, enabled: boolean) {
    if (!view) return;
    const off = new Set(view.disabledKinds);
    if (enabled) off.delete(kind);
    else off.add(kind);
    change({
      disabledKinds: notificationKindSchema.options.filter((k) => off.has(k)),
    });
  }

  const pushOff = view ? !view.pushEnabled : true;
  const transactionOff = view ? view.disabledKinds.includes("transaction") : false;
  const quietMessage = view ? quietError(view) : null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <PageBackHeader
        title="알림 설정"
        action={
          <SaveStatus
            state={saver.state}
            onRetry={() => {
              if (view) queue.schedule(toUpdateRequest(view, data), 0);
            }}
          />
        }
      />

      {isLoading ? (
        <ListLoading rows={3} label="알림 설정을 불러오는 중이에요." />
      ) : isError || !view ? (
        <ErrorState
          align="start"
          message="알림 설정을 불러오지 못했어요"
          retrying={isFetching}
          onRetry={() => void refetch()}
        />
      ) : (
        <>
          <section className="finance-panel overflow-hidden py-1">
            <SwitchRow
              id="push-enabled"
              title="푸시 알림"
              description="끄면 내 모든 기기로 푸시가 가지 않고, 알림함에는 그대로 남아요"
              checked={view.pushEnabled}
              onCheckedChange={(next) => change({ pushEnabled: next })}
            />
          </section>

          <section
            aria-labelledby="notification-kinds-title"
            className="finance-panel overflow-hidden pt-4 pb-1"
          >
            <h2
              id="notification-kinds-title"
              className="text-caption text-muted-foreground px-5 pb-1 font-semibold"
            >
              받을 알림
            </h2>
            {KIND_ROWS.map((row) => (
              <Fragment key={row.kind}>
                <SwitchRow
                  id={`kind-${row.kind}`}
                  title={row.name}
                  description={row.description}
                  checked={!view.disabledKinds.includes(row.kind)}
                  disabled={pushOff}
                  onCheckedChange={(next) => toggleKind(row.kind, next)}
                />
                {row.kind === "transaction" ? (
                  <>
                    {/* 본인 결제 — 카드사 문자와 겹쳐 기본 꺼짐(가족 결제는 항상 알림). */}
                    <SwitchRow
                      id="notify-own"
                      nested
                      title="내 결제도 알림"
                      description="카드사 문자와 겹쳐 기본은 꺼져 있고, 가족 결제는 항상 알려요"
                      checked={view.notifyOwnCollected}
                      disabled={pushOff || transactionOff}
                      onCheckedChange={(next) =>
                        change({ notifyOwnCollected: next })
                      }
                    />
                    <div className="flex min-h-14 items-center gap-4 py-2 pr-5 pl-10">
                      <label
                        htmlFor="min-amount"
                        className={cn(
                          "flex min-w-0 flex-1 flex-col gap-0.5",
                          (pushOff || transactionOff) && "opacity-50",
                        )}
                      >
                        <span className="text-body">최소 알림 금액</span>
                        <span
                          id="min-amount-description"
                          className="text-caption text-muted-foreground"
                        >
                          이보다 작은 결제는 알리지 않아요
                        </span>
                      </label>
                      <div className="relative w-36 shrink-0">
                        <AmountInput
                          id="min-amount"
                          aria-describedby="min-amount-description"
                          placeholder="제한 없음"
                          className={cn(
                            "text-right tabular-nums",
                            view.minAmount !== "" && "pr-9",
                          )}
                          disabled={pushOff || transactionOff}
                          digits={view.minAmount}
                          onDigitsChange={(digits) =>
                            change({ minAmount: digits }, INPUT_SAVE_DELAY_MS)
                          }
                        />
                        {view.minAmount !== "" ? (
                          <span
                            aria-hidden="true"
                            className="text-body text-muted-foreground pointer-events-none absolute inset-y-0 right-4 flex items-center"
                          >
                            원
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </>
                ) : null}
              </Fragment>
            ))}
          </section>

          <section className="finance-panel overflow-hidden py-1">
            <SwitchRow
              id="quiet-enabled"
              title="무음 시간대"
              description="정한 시간에는 푸시를 보내지 않아요"
              checked={view.quietEnabled}
              disabled={pushOff}
              onCheckedChange={(next) => change({ quietEnabled: next })}
            />
            {view.quietEnabled ? (
              <div className="flex flex-col gap-2 px-5 pb-4">
                <div className="flex items-end gap-3">
                  <label className="flex flex-1 flex-col gap-1.5">
                    <span className="text-caption text-muted-foreground">시작</span>
                    <Input
                      type="time"
                      value={view.quietStart}
                      disabled={pushOff}
                      aria-invalid={quietMessage !== null}
                      aria-describedby={quietMessage ? "quiet-error" : undefined}
                      onChange={(event) =>
                        change({ quietStart: event.target.value }, INPUT_SAVE_DELAY_MS)
                      }
                    />
                  </label>
                  <label className="flex flex-1 flex-col gap-1.5">
                    <span className="text-caption text-muted-foreground">끝</span>
                    <Input
                      type="time"
                      value={view.quietEnd}
                      disabled={pushOff}
                      aria-invalid={quietMessage !== null}
                      aria-describedby={quietMessage ? "quiet-error" : undefined}
                      onChange={(event) =>
                        change({ quietEnd: event.target.value }, INPUT_SAVE_DELAY_MS)
                      }
                    />
                  </label>
                </div>
                {quietMessage ? (
                  <p id="quiet-error" role="alert" className="text-caption text-destructive">
                    {quietMessage}
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
