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
 * 남는다(worker가 선호를 보기 전에 이력을 저장한다). 종류 이름은 안드로이드 알림 채널과 같은
 * 문구다 — 시스템 설정에서 찾는 이름과 같아야 한다. 설명도 채널 문구를 쓰되, 이름이 비슷한
 * '확인 리마인더'·'확인 요청'만 화면에서 풀어 쓴다(KIND_DESCRIPTION_OVERRIDES).
 *
 * 서버 값은 켜져 있어도 이 휴대폰의 OS 알림 권한이 없으면 여기로는 하나도 오지 않는다. 그래서
 * 들어올 때와 앱으로 돌아올 때(설정에서 켜고 오는 길) 권한을 읽어, 막혀 있으면 맨 위에 켜는 곳을
 * 안내하고 '푸시 알림' 설명을 실제 범위(내 다른 기기)로 바꾼다. 권한은 요청하지 않는다.
 *
 * 무음 시간대는 분(0~1439)으로 저장하고 HH:MM으로 다룬다. 시작=끝은 발송 쪽이 "무음 없음"
 * 으로 읽으므로 화면과 계약이 함께 막는다. 이미 저장된 시작=끝은 꺼진 것으로 보여 준다(같은
 * 뜻이다). 고치는 중인 무음 시간은 보내지 않고 마지막으로 저장된 값을 그대로 둔다.
 * ------------------------------------------------------------------------- */
import { Fragment, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  notificationKindSchema,
  type NotificationKind,
  type NotificationPreferencesUpdateRequest,
} from "@family/contracts";
import { NOTIFICATION_CHANNEL_META, NOTIFICATION_CHANNELS } from "@family/shared";

import { AmountInput } from "@/components/ui/amount-input";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  ErrorState,
  InlineNotice,
  ListLoading,
  PageBackHeader,
} from "@/components/widgets";
import {
  getNativePlatform,
  getPushPermissionState,
  retryPushRegistrationIfGranted,
  type NativePlatform,
  type PushPermissionState,
} from "@/lib/native";
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from "@/lib/queries";
import { cn } from "@/lib/utils";

import {
  draftFromServer,
  KIND_DESCRIPTION_OVERRIDES,
  pushPermissionNotice,
  pushSwitchDescription,
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

/** 종류별 행 — 계약의 종류 순서 그대로, 이름은 알림 채널 문구(설명은 헷갈리는 둘만 화면에서 풀어 쓴다). */
const KIND_ROWS = notificationKindSchema.options.map((kind) => {
  const meta = CHANNEL_META.get(NOTIFICATION_CHANNELS[kind]);
  return {
    kind,
    name: meta?.name ?? kind,
    description: KIND_DESCRIPTION_OVERRIDES[kind] ?? meta?.description,
  };
});

/**
 * 이 휴대폰의 알림 권한. 들어올 때와 앱으로 돌아올 때 다시 읽는다 — 안내를 보고 설정에서 켠 뒤
 * 돌아오면 안내가 바로 사라져야 한다(Capacitor 복귀도 웹뷰의 visibilitychange로 온다).
 * 켜고 돌아온 경우 이번 실행에서 못 한 푸시 등록을 마저 건다(native.ts).
 */
function usePushPermission(): { state: PushPermissionState; platform: NativePlatform } {
  const [permission, setPermission] = useState<{
    state: PushPermissionState;
    platform: NativePlatform;
  }>({ state: "unsupported", platform: "web" });

  useEffect(() => {
    let alive = true;
    const check = () => {
      if (document.visibilityState === "hidden") return;
      void getPushPermissionState().then((state) => {
        if (!alive) return;
        setPermission({ state, platform: getNativePlatform() });
        if (state === "granted") void retryPushRegistrationIfGranted();
      });
    };
    check();
    document.addEventListener("visibilitychange", check);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  return permission;
}

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

export default function NotificationSettingsPage() {
  const { data, isLoading, isError, isFetching, refetch } =
    useNotificationPreferences();
  const update = useUpdateNotificationPreferences();
  const saver = useAutoSave(update.mutateAsync);
  const permission = usePushPermission();
  const permissionNotice = pushPermissionNotice(
    permission.state,
    permission.platform,
  );
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
          {permissionNotice ? (
            <InlineNotice tone="error">
              <p className="font-semibold">{permissionNotice.title}</p>
              <p>{permissionNotice.howTo}</p>
            </InlineNotice>
          ) : null}

          <section className="finance-panel overflow-hidden py-1">
            <SwitchRow
              id="push-enabled"
              title="푸시 알림"
              description={pushSwitchDescription(permission.state)}
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
                      {/* 비어 있으면 '제한 없음'만 보인다 — 단위 '원'이 붙으면 '제한 없음 원'으로 읽힌다.
                          단위를 숨길 때는 AmountInput이 늘 붙이는 단위 자리(pr-10)도 되돌려 placeholder를 오른쪽 끝에 맞춘다
                          (자식 선택자가 .pr-10보다 우선한다). */}
                      <AmountInput
                        id="min-amount"
                        aria-describedby="min-amount-description"
                        placeholder="제한 없음"
                        containerClassName={cn(
                          "w-36 shrink-0",
                          view.minAmount === "" &&
                            "[&>span]:hidden [&>input]:pr-4",
                        )}
                        className="text-right"
                        disabled={pushOff || transactionOff}
                        value={view.minAmount}
                        onValueChange={(raw) =>
                          change(
                            { minAmount: raw.slice(0, MIN_AMOUNT_MAX_DIGITS) },
                            INPUT_SAVE_DELAY_MS,
                          )
                        }
                      />
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
