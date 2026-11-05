import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 알림 권한 읽기(알림 설정 화면의 '이 휴대폰은 알림이 꺼져 있어요')와 권한을 켜고 돌아왔을 때의
 * 푸시 재등록. 권한을 **요청하지 않는다**는 것이 핵심 계약이다.
 */
const mocks = vi.hoisted(() => ({
  native: true,
  platform: "android",
  receive: "granted" as string,
  checkThrows: false,
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  register: vi.fn(async () => undefined),
  addListener: vi.fn(async () => ({ remove: async () => undefined })),
  createChannel: vi.fn(async () => undefined),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => mocks.native,
    getPlatform: () => mocks.platform,
  },
}));
vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
}));
vi.mock("@capacitor/push-notifications", () => ({
  PushNotifications: {
    checkPermissions: mocks.checkPermissions,
    requestPermissions: mocks.requestPermissions,
    register: mocks.register,
    addListener: mocks.addListener,
    createChannel: mocks.createChannel,
  },
}));
vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    registerActionTypes: vi.fn(async () => undefined),
    addListener: vi.fn(async () => ({ remove: async () => undefined })),
  },
}));

// 첫 콜드 import가 느려 5초 제한을 넘길 수 있다(native.test.ts와 같은 이유) — 미리 데운다.
beforeAll(async () => {
  await import("./native");
}, 60_000);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("window", {});
  mocks.native = true;
  mocks.platform = "android";
  mocks.receive = "granted";
  mocks.checkThrows = false;
  mocks.checkPermissions.mockImplementation(async () => {
    if (mocks.checkThrows) throw new Error("plugin missing");
    return { receive: mocks.receive };
  });
  mocks.requestPermissions.mockImplementation(async () => ({
    receive: mocks.receive,
  }));
});

describe("이 휴대폰의 알림 권한 읽기", () => {
  it("웹에서는 플러그인을 부르지 않고 'unsupported'다", async () => {
    mocks.native = false;
    const { getPushPermissionState, getNativePlatform } = await import(
      "./native"
    );
    expect(await getPushPermissionState()).toBe("unsupported");
    expect(getNativePlatform()).toBe("web");
    expect(mocks.checkPermissions).not.toHaveBeenCalled();
  });

  it.each([
    ["granted", "granted"],
    ["denied", "denied"],
    ["prompt", "prompt"],
    // 한 번 거절한 상태도 아직 허용이 아니다.
    ["prompt-with-rationale", "prompt"],
  ])("플러그인 %s → %s, 권한을 요청하지 않는다", async (receive, expected) => {
    mocks.receive = receive;
    const { getPushPermissionState } = await import("./native");
    expect(await getPushPermissionState()).toBe(expected);
    expect(mocks.requestPermissions).not.toHaveBeenCalled();
  });

  it("읽지 못하면 꺼졌다고 단정하지 않는다('unsupported')", async () => {
    mocks.checkThrows = true;
    const { getPushPermissionState } = await import("./native");
    expect(await getPushPermissionState()).toBe("unsupported");
  });

  it("iOS는 iOS로 읽는다", async () => {
    mocks.platform = "ios";
    const { getNativePlatform } = await import("./native");
    expect(getNativePlatform()).toBe("ios");
  });
});

describe("설정에서 알림을 켜고 돌아왔을 때의 푸시 재등록", () => {
  it("앱이 푸시를 초기화한 적이 없으면 아무것도 하지 않는다", async () => {
    const { retryPushRegistrationIfGranted } = await import("./native");
    await retryPushRegistrationIfGranted();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("거부로 시작했다가 허용으로 바뀌면 그때 등록한다 — 요청 창은 띄우지 않는다", async () => {
    mocks.receive = "denied";
    const { initPushNotifications, retryPushRegistrationIfGranted } =
      await import("./native");
    await initPushNotifications({ onToken: vi.fn() });
    expect(mocks.register).not.toHaveBeenCalled();

    // 아직 거부면 그대로 둔다.
    await retryPushRegistrationIfGranted();
    expect(mocks.register).not.toHaveBeenCalled();

    mocks.receive = "granted";
    await retryPushRegistrationIfGranted();
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(mocks.requestPermissions).not.toHaveBeenCalled();
  });
});
