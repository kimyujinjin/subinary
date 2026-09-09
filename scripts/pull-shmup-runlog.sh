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
OUT="${OUT:-apps/shmup/builds/runlog-$(date +%Y%m%d-%H%M%S).csv}"
mkdir -p "$(dirname "$OUT")"

usage() { echo "usage: $0 {ios|android|local} [--unexplained N] [--predict-in N] [--predict-out N]"; exit 2; }
[ $# -ge 1 ] || usage
SRC="$1"; shift

case "$SRC" in
  local)
    # 맥 에디터 실행분. 조작 판정에는 쓸 수 없다 —
    # 합성 터치는 index 0 하나뿐이고 device = DEVICE_ID_EMULATION 이다.
    cp "$HOME/Library/Application Support/Godot/app_userdata/LumenDrift/runlog.csv" "$OUT"
    ;;
  android)
    # adb 는 exec-out 을 쓴다. shell 경유는 CRLF 변환으로 CSV 를 망친다.
    adb exec-out run-as "$BUNDLE" cat files/runlog.csv > "$OUT"
    ;;
  ios)
    # iOS 는 CLI 로 컨테이너를 못 뽑는다(Xcode → Devices and Simulators →
    # Download Container → AppData/Documents/runlog.csv). 내려받은 .xcappdata 경로를 받는다.
    [ $# -ge 1 ] || { echo "ios: 내려받은 .xcappdata 경로를 인자로 주라"; exit 2; }
    CONT="$1"; shift
    cp "$CONT/AppData/Documents/runlog.csv" "$OUT"
    ;;
  *) usage ;;
esac

echo "가져옴: $OUT ($(wc -l < "$OUT") 행)"
node scripts/verify-shmup-funloop.mjs "$OUT" "$@"
