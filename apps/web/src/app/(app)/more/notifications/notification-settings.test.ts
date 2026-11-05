import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationPreferences } from "@family/contracts";

import {
  draftFromServer,
  groupDigits,
  pushBlockedOnThisPhone,
  pushPermissionNotice,
  pushSwitchDescription,
  quietError,
  SaveQueue,
  toUpdateRequest,
  type SaveState,
} from "./notification-settings";

const saved: NotificationPreferences = {
  pushEnabled: true,
  minAmount: 10_000,
  quietStartMinute: 22 * 60,
  quietEndMinute: 7 * 60,
  notifyOwnCollected: false,
  disabledKinds: ["summary"],
};

describe("알림 설정 — 화면 값과 저장 요청", () => {
  it("저장된 값을 그대로 되돌려 보내면 같은 요청이 된다(불필요한 저장 없음)", () => {
    const draft = draftFromServer(saved);
    expect(draft).toMatchObject({
      minAmount: "10000",
      quietEnabled: true,
      quietStart: "22:00",
      quietEnd: "07:00",
      disabledKinds: ["summary"],
    });
    expect(toUpdateRequest(draft, saved)).toEqual({
      pushEnabled: true,
      minAmount: 10_000,
      quietStartMinute: 1320,
      quietEndMinute: 420,
      notifyOwnCollected: false,
      disabledKinds: ["summary"],
    });
  });

  it("이미 저장된 시작=끝은 꺼진 무음으로 보여 준다 — 발송 쪽도 무음 없음으로 읽는다", () => {
    const draft = draftFromServer({
      ...saved,
      quietStartMinute: 600,
      quietEndMinute: 600,
    });
    expect(draft.quietEnabled).toBe(false);
    expect(toUpdateRequest(draft, saved)).toMatchObject({
      quietStartMinute: null,
      quietEndMinute: null,
    });
  });

  it("필드를 모르는 옛 서버 응답은 모든 종류를 받는 것으로 본다", () => {
    const { disabledKinds: _omit, ...oldServer } = saved;
    expect(
      draftFromServer(oldServer as NotificationPreferences).disabledKinds
    ).toEqual([]);
  });

  it("시작과 끝이 같으면 오류를 보이고, 다른 스위치를 저장할 때는 마지막 무음 값을 지킨다", () => {
    const draft = {
      ...draftFromServer(saved),
      quietStart: "23:00",
      quietEnd: "23:00",
      pushEnabled: false,
    };
    expect(quietError(draft)).toBe("시작과 끝을 다르게 정해 주세요");
    expect(toUpdateRequest(draft, saved)).toMatchObject({
      pushEnabled: false,
      quietStartMinute: 1320,
      quietEndMinute: 420,
    });
    expect(quietError({ ...draft, quietEnd: "" })).toBe(
      "시작과 끝 시간을 골라 주세요"
    );
    expect(quietError({ ...draft, quietEnabled: false })).toBeNull();
  });

  it("빈 최소 금액은 제한 없음(null)이고, 금액은 천 단위로 끊어 보여 준다", () => {
    expect(
      toUpdateRequest({ ...draftFromServer(saved), minAmount: "" }, saved)
        .minAmount
    ).toBeNull();
    expect(groupDigits("1234567")).toBe("1,234,567");
    expect(groupDigits("999")).toBe("999");
    expect(groupDigits("")).toBe("");
  });
});

describe("SaveQueue — 바꾸면 바로 저장", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function harness(fail = false) {
    const calls: number[] = [];
    const resolvers: Array<{
      resolve: () => void;
      reject: (e: Error) => void;
    }> = [];
    const states: SaveState[] = [];
    const onError = vi.fn();
    const queue = new SaveQueue<{ value: number }>(
      (body) => {
        calls.push(body.value);
        return new Promise<void>((resolve, reject) => {
          resolvers.push({ resolve, reject });
          if (fail) reject(new Error("network"));
        });
      },
      (state) => states.push(state),
      onError
    );
    return { queue, calls, resolvers, states, onError };
  }

  it("입력칸은 멈춘 뒤 한 번, 마지막 값으로 저장한다", async () => {
    const { queue, calls } = harness();
    queue.schedule({ value: 1 }, 600);
    queue.schedule({ value: 12 }, 600);
    await vi.advanceTimersByTimeAsync(599);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual([12]);
  });

  it("앞 요청이 끝나기 전 변경은 줄 세워 마지막 값 하나만 이어서 보낸다", async () => {
    const { queue, calls, resolvers, states } = harness();
    queue.schedule({ value: 1 }, 0);
    queue.schedule({ value: 2 }, 0);
    queue.schedule({ value: 3 }, 0);
    expect(calls).toEqual([1]);
    resolvers[0]?.resolve();
    await vi.runAllTimersAsync();
    expect(calls).toEqual([1, 3]);
    resolvers[1]?.resolve();
    await vi.runAllTimersAsync();
    expect(states.at(-1)).toBe("saved");
  });

  it("이미 저장된 값과 같으면 보내지 않는다(켰다가 바로 끄기)", async () => {
    const { queue, calls } = harness();
    queue.markSaved({ value: 5 });
    queue.schedule({ value: 5 }, 0);
    expect(calls).toEqual([]);
  });

  it("실패하면 오류 상태와 알림, 다시 시도하면 같은 값을 다시 보낸다", async () => {
    const failing = harness(true);
    failing.queue.schedule({ value: 7 }, 0);
    await vi.runAllTimersAsync();
    expect(failing.states.at(-1)).toBe("error");
    expect(failing.onError).toHaveBeenCalledTimes(1);
    failing.queue.schedule({ value: 7 }, 0);
    expect(failing.calls).toEqual([7, 7]);
  });

  it("실패 뒤 저장된 값으로 되돌리면 오류를 거둔다", async () => {
    const failing = harness(true);
    failing.queue.markSaved({ value: 1 });
    failing.queue.schedule({ value: 2 }, 0);
    await vi.runAllTimersAsync();
    expect(failing.states.at(-1)).toBe("error");
    failing.queue.schedule({ value: 1 }, 0);
    expect(failing.states.at(-1)).toBe("saved");
    expect(failing.calls).toEqual([2]);
  });

  it("화면을 떠나면(flush) 기다리던 입력을 바로 보낸다", () => {
    const { queue, calls } = harness();
    queue.schedule({ value: 9 }, 600);
    queue.flush();
    expect(calls).toEqual([9]);
  });
});

describe("이 휴대폰의 알림 권한 안내", () => {
  it("거부·아직 허용 전이면 맨 위에 꺼져 있다는 사실과 켜는 곳을 알린다", () => {
    for (const state of ["denied", "prompt"] as const) {
      expect(pushBlockedOnThisPhone(state)).toBe(true);
      expect(pushPermissionNotice(state, "android")).toEqual({
        title: "이 휴대폰은 알림이 꺼져 있어요",
        howTo: "휴대폰 설정 › 애플리케이션 › 모아 › 알림에서 켜 주세요",
      });
    }
    expect(pushPermissionNotice("denied", "ios")?.howTo).toBe(
      "iPhone 설정 › 앱 › 모아 › 알림에서 켜 주세요"
    );
  });

  it("허용이거나 모르면(웹·읽기 실패) 안내하지 않는다 — 모를 때 꺼졌다고 말하지 않는다", () => {
    for (const state of ["granted", "unsupported"] as const) {
      expect(pushBlockedOnThisPhone(state)).toBe(false);
      expect(pushPermissionNotice(state, "android")).toBeNull();
    }
  });

  it("막혀 있으면 푸시 스위치 설명이 실제 범위(내 다른 기기)를 말한다", () => {
    expect(pushSwitchDescription("denied")).toBe(
      "지금은 내 다른 기기에만 적용돼요. 알림함에는 그대로 남아요"
    );
    expect(pushSwitchDescription("granted")).toBe(
      "끄면 내 모든 기기로 푸시가 가지 않고, 알림함에는 그대로 남아요"
    );
    expect(pushSwitchDescription("unsupported")).toBe(
      pushSwitchDescription("granted")
    );
  });
});
