#!/usr/bin/env bash
# iOS export. 실패하면 점검 순서를 고정해서 출력한다 —
# Godot 의 iOS export 는 원인을 알려주지 않는 실패 모드가 여럿이고,
# 그중 하나는 메시지를 아예 내지 않는다(아래 ⑤).
#
# 로그를 | tail 로 자르지 않는다. Godot 의 "xcodebuild failed with code 0" 같은
# 부실한 메시지와 결합하면 진단이 불가능해진다.
set -euo pipefail

GODOT="${GODOT:-$HOME/Applications/Godot.app/Contents/MacOS/Godot}"
PRESET="${PRESET:-iOS}"
MODE="${1:-debug}"          # debug | release
cd "$(dirname "$0")/.."

OUT="builds/ios/lumen_drift.ipa"
mkdir -p builds/ios
LOG="builds/ios/export-$(date +%Y%m%d-%H%M%S).log"

echo "== iOS export ($MODE) =="
"$GODOT" --headless --path . --language en "--export-$MODE" "$PRESET" "$OUT" 2>&1 | tee "$LOG"
rc=${PIPESTATUS[0]}

if [ "$rc" -ne 0 ] || [ ! -f "$OUT" ]; then
	cat <<'EOF'

── 실패. 이 순서로 점검한다 ───────────────────────────────────────────────
① 프로젝트명 특수문자   project.godot 의 config/name 에 공백·& 가 있으면 조용히 깨진다
② Team ID 10자         export_presets.cfg 의 application/app_store_team_id
                       확인: security find-identity -v -p codesigning
③ Code Sign Identity   유효한 Apple Development 인증서가 있는가
④ Xcode 약관 동의      sudo xcodebuild -license accept
⑤ ETC2/ASTC           rendering/textures/vram_compression/import_etc2_astc = true
                       ★ 이것이 꺼져 있으면 Godot 이 "configuration errors:" 뒤에
                         아무 메시지도 없이 실패한다. 근거는 4.7.2 소스의
                         editor/export/editor_export_platform_apple_embedded.cpp —
                         has_valid_project_configuration 이 should_import_etc2_astc()
                         실패 시 r_error 를 채우지 않고 valid=false 만 한다.
                       확인: scripts/doctor.sh 가 이 값을 대조한다
⑥ export 폴더명        프로젝트명과 같으면 Xcode 서명이 충돌한다
⑦ 애드온               addons/ 의 플러그인이 iOS 템플릿과 충돌하는지
EOF
	exit 1
fi

echo
echo "산출물: $OUT ($(du -h "$OUT" | cut -f1))"
echo "로그  : $LOG"
# 서명과 프로파일을 항상 확인한다 — 무료 팀이면 7일 뒤 앱이 열리지 않는다.
TMP=$(mktemp -d)
unzip -q "$OUT" -d "$TMP"
APP=$(find "$TMP/Payload" -maxdepth 1 -name "*.app" | head -1)
codesign -dv --verbose=2 "$APP" 2>&1 | grep -E "^(Identifier|TeamIdentifier|Authority=Apple Dev)" || true
python3 - "$APP/embedded.mobileprovision" <<'PY'
import sys, plistlib
raw = open(sys.argv[1], 'rb').read()
i, j = raw.find(b'<?xml'), raw.rfind(b'</plist>')
d = plistlib.loads(raw[i:j+8])
span = (d['ExpirationDate'] - d['CreationDate']).days
print("프로파일 만료: %s (%d일 · 기기 %d대)" % (
    d['ExpirationDate'], span, len(d.get('ProvisionedDevices') or [])))
print("→ 무료 개인 팀. 7일마다 재배포해야 한다." if span <= 10
      else "→ 유료 Apple Developer Program 유효.")
PY
rm -rf "$TMP"
echo
echo "설치: xcrun devicectl device install app --device <UDID> $OUT"
echo "로그: scripts/pull-shmup-runlog.sh ios <내려받은 .xcappdata 경로>"
