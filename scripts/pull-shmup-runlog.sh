#!/usr/bin/env bash
# 실기의 RunLog CSV 를 개발 머신으로 가져와 곧바로 판정을 출력한다.
#
# 이 스크립트가 존재하는 이유: 판정은 실기 release 빌드에서만 유효한데
# release 빌드에는 에디터의 remote debug 콘솔이 없고 화면 HUD 숫자는 5분 동안
# 흘러가 버린다. 꺼낼 방법이 없으면 결국 에디터에서 판정하게 되고, 그건 틀린다.
#
# 로그를 | tail 로 자르지 않는다 — 이 저장소가 이미 배운 교훈이다.
set -euo pipefail

BUNDLE="${BUNDLE:-dev.subinary.lumendrift}"
# adb 는 PATH 에 없는 것이 정상이다 — Android Studio 가 넣어 주지 않는다.
ADB="${ADB:-$(command -v adb || echo "$HOME/Library/Android/sdk/platform-tools/adb")}"
# 저장소 루트를 기준으로 삼는다. CLAUDE.md 는 이 스크립트를 apps/shmup 에서
# `../../scripts/pull-shmup-runlog.sh` 로 부르라고 안내하는데, 상대 경로로 두면
# 그때 apps/shmup/apps/shmup/builds/ 에 쓰려다 판정이 안 나온다.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${OUT:-$ROOT/apps/shmup/builds/runlog-$(date +%Y%m%d-%H%M%S).csv}"
mkdir -p "$(dirname "$OUT")"
# 리다이렉션은 명령이 실패해도 파일을 만든다 — 0바이트 로그가 남으면
# 다음 판정이 "빌드 불명 · 사망 0회" 로 오염된다. 임시 파일에 받고 검증 후 옮긴다.
TMP_OUT="$(mktemp)"
trap 'rm -f "$TMP_OUT"' EXIT
finish() {
	if [ ! -s "$TMP_OUT" ]; then
		echo "회수 실패: 로그가 비어 있다. 앱을 한 번이라도 실행했는가?" >&2
		exit 1
	fi
	mv "$TMP_OUT" "$OUT"
	trap - EXIT
}

usage() { echo "usage: $0 {ios|android|local} [--unexplained N] [--predict-in N] [--predict-out N]"; exit 2; }
[ $# -ge 1 ] || usage
SRC="$1"; shift

case "$SRC" in
  local)
    # 맥 에디터 실행분. 조작 판정에는 쓸 수 없다 —
    # 합성 터치는 index 0 하나뿐이고 device = DEVICE_ID_EMULATION 이다.
    cp "$HOME/Library/Application Support/Godot/app_userdata/LumenDrift/runlog.csv" "$TMP_OUT"
    finish
    ;;
  android)
    # adb 는 exec-out 을 쓴다. shell 경유는 CRLF 변환으로 CSV 를 망친다.
    # exec-out 을 쓴다. shell 경유는 CRLF 변환으로 CSV 를 망친다.
    # run-as 는 앱이 debuggable 이어야 동작한다(debug export 는 그렇다).
    # release 는 debuggable 이 아니라 run-as 가 막힌다("package not debuggable").
    # 앱이 외부 앱 디렉터리에도 쓰므로 거기서 먼저 가져오고, 없으면 run-as 로 되돌아간다.
    EXT="/sdcard/Android/data/$BUNDLE/files/runlog.csv"
    if "$ADB" shell "test -f $EXT" >/dev/null 2>&1; then
      "$ADB" exec-out "cat $EXT" > "$TMP_OUT"
    else
      "$ADB" exec-out run-as "$BUNDLE" cat files/runlog.csv > "$TMP_OUT"
    fi
    finish
    ;;
  ios)
    # iOS 는 CLI 로 컨테이너를 못 뽑는다(Xcode → Devices and Simulators →
    # Download Container → AppData/Documents/runlog.csv). 내려받은 .xcappdata 경로를 받는다.
    [ $# -ge 1 ] || { echo "ios: 내려받은 .xcappdata 경로를 인자로 주라"; exit 2; }
    CONT="$1"; shift
    cp "$CONT/AppData/Documents/runlog.csv" "$TMP_OUT"
    finish
    ;;
  *) usage ;;
esac

echo "가져옴: $OUT ($(wc -l < "$OUT") 행)"
node scripts/verify-shmup-funloop.mjs "$OUT" "$@"
