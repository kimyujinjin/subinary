/* ---------------------------------------------------------------------------
 * 알림 설정 화면의 순수 로직 — 화면 값 ↔ 저장 요청 변환과 "바꾸면 바로 저장" 줄 세우기.
 *
 * 화면(page.tsx)에서 떼어 둔 이유: 저장 순서·중복 제거·실패 처리는 눈으로 확인하기 어렵고,
 * 틀리면 "껐는데 다시 켜져 있다"로만 드러난다. 여기서 가짜 타이머로 고정한다.
 * ------------------------------------------------------------------------- */
import type {
  NotificationKind,
  NotificationPreferences,
  NotificationPreferencesUpdateRequest,
} from "@family/contracts";

import type { NativePlatform, PushPermissionState } from "@/lib/native";

export const DEFAULT_QUIET_START = "22:00";
export const DEFAULT_QUIET_END = "07:00";

export interface NotificationSettingsDraft {
  pushEnabled: boolean;
  notifyOwnCollected: boolean;
  /** 숫자만. 빈 문자열 = 제한 없음. */
  minAmount: string;
  quietEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  disabledKinds: NotificationKind[];
}

/** 분(0~1439) → "HH:MM". */
export function minuteToTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** "HH:MM"(초가 붙어도 됨) → 분(0~1439). 유효하지 않으면 null. */
export function timeToMinute(v: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(v);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** "1234567" → "1,234,567". */
export function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function draftFromServer(
  prefs: NotificationPreferences
): NotificationSettingsDraft {
  const start = prefs.quietStartMinute;
  const end = prefs.quietEndMinute;
  // 시작=끝은 발송 쪽에서 "무음 없음"이다 — 꺼진 것으로 보여 줘야 화면과 실제가 같다.
  const quiet = start !== null && end !== null && start !== end;
  return {
    pushEnabled: prefs.pushEnabled,
    notifyOwnCollected: prefs.notifyOwnCollected,
    minAmount: prefs.minAmount !== null ? String(prefs.minAmount) : "",
    quietEnabled: quiet,
    quietStart: quiet ? minuteToTime(start) : DEFAULT_QUIET_START,
    quietEnd: quiet ? minuteToTime(end) : DEFAULT_QUIET_END,
    // 필드를 모르는 옛 서버의 응답은 "모든 종류를 받음"과 같다.
    disabledKinds:
      (prefs as Partial<NotificationPreferences>).disabledKinds ?? [],
  };
}

/** 무음 시간대 입력 오류(없으면 null). */
export function quietError(draft: NotificationSettingsDraft): string | null {
  if (!draft.quietEnabled) return null;
  const start = timeToMinute(draft.quietStart);
  const end = timeToMinute(draft.quietEnd);
  if (start === null || end === null) return "시작과 끝 시간을 골라 주세요";
  if (start === end) return "시작과 끝을 다르게 정해 주세요";
  return null;
}

/**
 * 화면 값 → 저장 요청(전체 대체). 고치는 중인(유효하지 않은) 무음 시간은 보내지 않고
 * 마지막으로 저장된 값을 쓴다 — 다른 스위치를 바꿀 때 무음 설정을 날리지 않게.
 */
export function toUpdateRequest(
  draft: NotificationSettingsDraft,
  saved: NotificationPreferences | undefined
): NotificationPreferencesUpdateRequest {
  let quietStartMinute: number | null = null;
  let quietEndMinute: number | null = null;
  if (draft.quietEnabled) {
    const start = timeToMinute(draft.quietStart);
    const end = timeToMinute(draft.quietEnd);
    if (start !== null && end !== null && start !== end) {
      quietStartMinute = start;
      quietEndMinute = end;
    } else if (
      saved &&
      saved.quietStartMinute !== null &&
      saved.quietEndMinute !== null &&
      saved.quietStartMinute !== saved.quietEndMinute
    ) {
      quietStartMinute = saved.quietStartMinute;
      quietEndMinute = saved.quietEndMinute;
    }
  }
  return {
    pushEnabled: draft.pushEnabled,
    minAmount: draft.minAmount === "" ? null : Number(draft.minAmount),
    quietStartMinute,
    quietEndMinute,
    notifyOwnCollected: draft.notifyOwnCollected,
    disabledKinds: draft.disabledKinds,
  };
}

/**
 * 화면에서만 풀어 쓰는 종류 설명. 이름('확인 리마인더'·'확인 요청')은 Android 시스템 설정의 채널 이름과
 * 같아야 해서(packages/shared) 그대로 두고, 이름이 비슷한 두 알림이 무엇을 알리는지만 여기서 가른다.
 */
export const KIND_DESCRIPTION_OVERRIDES: Partial<Record<NotificationKind, string>> = {
  reminder: "확인 필요·중복 의심으로 남은 거래 알림",
  review: "가족끼리 물어본 결제와 그 답",
};

/** 이 휴대폰이 푸시를 못 받는 권한 상태인가 — 거부, 그리고 아직 허용하지 않은 상태(한 번 거절 포함). */
export function pushBlockedOnThisPhone(permission: PushPermissionState): boolean {
  return permission === "denied" || permission === "prompt";
}

/**
 * 맨 위 안내(받을 수 있으면 null). 설정 앱을 여는 플러그인이 없고 새 네이티브 플러그인은 앱 업데이트
 * 없이 나갈 수 없어서, 켜는 곳을 글로 안내한다.
 */
export function pushPermissionNotice(
  permission: PushPermissionState,
  platform: NativePlatform
): { title: string; howTo: string } | null {
  if (!pushBlockedOnThisPhone(permission)) return null;
  return {
    title: "이 휴대폰은 알림이 꺼져 있어요",
    howTo:
      platform === "ios"
        ? "iPhone 설정 › 앱 › 모아 › 알림에서 켜 주세요"
        : "휴대폰 설정 › 애플리케이션 › 모아 › 알림에서 켜 주세요",
  };
}

/**
 * '푸시 알림' 스위치 설명. 이 휴대폰이 OS에서 막혀 있으면 스위치가 켜져 있어도 여기로는 오지 않으므로,
 * 스위치가 지금 실제로 다루는 범위(내 다른 기기)를 말한다.
 */
export function pushSwitchDescription(permission: PushPermissionState): string {
  return pushBlockedOnThisPhone(permission)
    ? "지금은 내 다른 기기에만 적용돼요. 알림함에는 그대로 남아요"
    : "끄면 내 모든 기기로 푸시가 가지 않고, 알림함에는 그대로 남아요";
}

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * "바꾸면 바로 저장" 줄 세우기.
 *
 * - 요청은 **한 번에 하나**다. 앞 요청이 끝나기 전의 변경은 마지막 값 하나만 남겨 두었다가
 *   보낸다 — 응답 순서가 뒤집혀 옛 값이 마지막에 저장되는 일을 막는다(전체 대체 PUT이라
 *   순서가 곧 결과다).
 * - 마지막으로 저장된 것과 같은 요청은 보내지 않는다(켰다 끄기, 고치는 중인 무음 시간).
 * - `schedule(body, ms)`는 ms 동안 더 바뀌지 않으면 보낸다(입력칸). 0이면 바로(스위치).
 * - `flush()`는 기다리던 것을 바로 보낸다(화면을 떠날 때).
 */
export class SaveQueue<T> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: T | null = null;
  private queued: T | null = null;
  private inFlight = false;
  private lastSaved: string | null = null;
  private state: SaveState = "idle";

  constructor(
    private readonly save: (body: T) => Promise<unknown>,
    private readonly onStateChange: (state: SaveState) => void,
    private readonly onError: () => void
  ) {}

  /** 서버에 이미 있는 값(처음 불러온 값)을 "저장됨"으로 기록한다. */
  markSaved(body: T): void {
    this.lastSaved = JSON.stringify(body);
  }

  schedule(body: T, delayMs: number): void {
    this.pending = body;
    this.clearTimer();
    if (delayMs <= 0) this.flush();
    else this.timer = setTimeout(() => this.flush(), delayMs);
  }

  flush(): void {
    this.clearTimer();
    const body = this.pending;
    this.pending = null;
    if (body !== null) this.send(body);
  }

  private send(body: T): void {
    if (this.inFlight) {
      this.queued = body;
      return;
    }
    const key = JSON.stringify(body);
    if (key === this.lastSaved) {
      // 실패 뒤 사용자가 저장된 값으로 되돌렸다면 더 보낼 것이 없다.
      if (this.state === "error") this.setState("saved");
      return;
    }
    this.inFlight = true;
    this.setState("saving");
    this.save(body)
      .then(
        () => {
          this.lastSaved = key;
          this.setState(this.queued !== null ? "saving" : "saved");
        },
        () => {
          this.setState("error");
          this.onError();
        }
      )
      .finally(() => {
        this.inFlight = false;
        const next = this.queued;
        this.queued = null;
        if (next !== null) this.send(next);
      });
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private setState(state: SaveState): void {
    this.state = state;
    this.onStateChange(state);
  }
}
