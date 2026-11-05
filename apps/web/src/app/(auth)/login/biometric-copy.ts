/**
 * 생체 인식 이름을 기기에 맞게 부른다.
 *
 * 주 사용 기기인 안드로이드에도 'Face ID'라고 쓰고 있었다(2026-11-05 HIG 검수). Face ID는 아이폰 이름이고,
 * 안드로이드는 기기마다 지문·얼굴 중 무엇을 쓰는지 다르므로 둘 다 부른다.
 */
import { Capacitor } from "@capacitor/core";

export interface BiometricCopy {
  /** 'Face ID', '지문·얼굴 인식' */
  name: string;
  /** 조사까지 붙인 형태('Face ID로', '지문·얼굴 인식으로') — 받침에 따라 달라 따로 둔다. */
  by: string;
}

export function biometricCopyFor(platform: string): BiometricCopy {
  if (platform === "ios") return { name: "Face ID", by: "Face ID로" };
  if (platform === "android") {
    return { name: "지문·얼굴 인식", by: "지문·얼굴 인식으로" };
  }
  // 전체 탭의 설정 이름('생체인식 잠금')과 같은 말로 부른다.
  return { name: "생체인식", by: "생체인식으로" };
}

/** 지금 기기의 이름. 웹·정적 렌더에서는 일반 이름이다(생체 인식 흐름은 네이티브에서만 열린다). */
export function currentBiometricCopy(): BiometricCopy {
  return biometricCopyFor(
    typeof window === "undefined" ? "web" : Capacitor.getPlatform()
  );
}
