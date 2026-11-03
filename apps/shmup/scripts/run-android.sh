#!/usr/bin/env bash
# Android 실기 실행. export → 설치 → 기동 → 기기 사양 기록까지 한 번에.
#
# 게이트 1 판정은 release 빌드 기준이지만, P1(터치 index 확인)은 debug 로도 유효하다.
# release 로 바꾸려면 첫 인자에 release 를 준다.
set -euo pipefail

SDK="${ANDROID_SDK:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
GODOT="${GODOT:-$HOME/Applications/Godot.app/Contents/MacOS/Godot}"
PKG="dev.subinary.lumendrift"
MODE="${1:-debug}"
APK="builds/android/lumen_drift.apk"
cd "$(dirname "$0")/.."

# release 서명 정보. **저장소에 두지 않는다** — export_presets.cfg 는 git 이 추적하고,
# 거기에 비밀번호를 적으면 커밋으로 새어 나간다. Godot 은 이 환경변수들을 직접 읽는다.
SIGN_ENV="$HOME/.config/lumendrift/android-release.env"
if [ "$MODE" = "release" ]; then
  if [ ! -f "$SIGN_ENV" ]; then
    cat <<EOF
release 서명 정보가 없다: $SIGN_ENV
키스토어를 만들고 그 파일에 아래 3줄을 넣어라(권한 600).
  export GODOT_ANDROID_KEYSTORE_RELEASE_PATH=...
  export GODOT_ANDROID_KEYSTORE_RELEASE_USER=...
  export GODOT_ANDROID_KEYSTORE_RELEASE_PASSWORD=...
EOF
    exit 1
  fi
  # shellcheck disable=SC1090
  . "$SIGN_ENV"
fi

"$ADB" start-server >/dev/null 2>&1 || true
STATE=$("$ADB" devices | awk 'NR>1 && NF>1 {print $2; exit}')
case "${STATE:-none}" in
  device) : ;;
  unauthorized)
    cat <<'EOF'
기기가 unauthorized 다. 폰 화면의 "USB 디버깅을 허용하시겠습니까?" 에서
[허용] 을 눌러야 한다. 다이얼로그가 안 보이면:
  · 폰 잠금을 해제한 상태로 케이블을 다시 꽂는다
  · 설정 → 개발자 옵션 → "USB 디버깅 승인 취소" 후 재연결
EOF
    exit 1 ;;
  none) echo "연결된 기기가 없다. adb devices 가 비어 있다."; exit 1 ;;
  *) echo "기기 상태: $STATE"; exit 1 ;;
esac

echo "== export ($MODE) =="
mkdir -p builds/android
# `| tail` 은 실패를 삼킨다(pipefail 이 있어도 마지막 3줄만 보면 원인 줄이 사라진다).
# release 키스토어가 없을 때 실제 원인은 "Could not find release keystore" 한 줄이었는데
# tail -3 이 그걸 잘라내서 "failed" 만 남았다 — iOS 때와 같은 함정이다.
LOG="builds/android/export-$MODE.log"
if ! "$GODOT" --headless --path . --language en "--export-$MODE" "Android" "$APK" > "$LOG" 2>&1; then
  echo "export 실패. 원인 줄:"
  grep -iE "error|warning|could not|unable" "$LOG" | grep -v "^ADDING" | tail -8
  echo "전체 로그: $LOG"
  exit 1
fi
grep -iE "warning|could not|unable" "$LOG" | tail -3 || true

echo "== 설치 =="
# -r 재설치, -d 다운그레이드 허용(개발 중 versionCode 가 고정이라 필요하다)
"$ADB" install -r -d "$APK"

echo "== 기기 사양 (판정 기록용) =="
p() { printf '  %-14s %s\n' "$1" "$("$ADB" shell "$2" 2>/dev/null | tr -d '\r')"; }
p 모델 "getprop ro.product.model"
p 안드로이드 "getprop ro.build.version.release"
p ABI "getprop ro.product.cpu.abi"
p 해상도 "wm size"
p 밀도 "wm density"
echo "  패널 fps      $("$ADB" shell dumpsys display 2>/dev/null | grep -oE 'fps=[0-9.]+' | sort -u | tr '\n' ' ')"

echo "== 기동 =="
"$ADB" shell am force-stop "$PKG" >/dev/null 2>&1 || true
"$ADB" logcat -c >/dev/null 2>&1 || true
"$ADB" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 4
echo "-- godot 로그 (10초) --"
timeout 10 "$ADB" logcat -s godot:V GodotEngine:V AndroidRuntime:E DEBUG:E 2>/dev/null || true
echo
echo "실행 중이면 화면에서 확인할 것 (P1 게이트):"
echo "  · 두 손가락을 동시에 올렸을 때 #0 #1 이 각각 보이는가"
echo "  · DRAG 역할이 하나에만 붙고, 외곽 90유닛은 EXCL 로 표시되는가"
echo "  · 프레임당 델타(px)가 손가락을 멈추면 0 이 되는가"
echo
echo "판정 로그 회수: ../../scripts/pull-shmup-runlog.sh android"
