#!/usr/bin/env bash
# 환경 대조. .godot-version 과 실제 엔진, 프로젝트 설정 키의 존재를 확인한다.
# 설정 키 이름이 틀리면 Godot 은 에러도 경고도 없이 무시한다 — 그게 이 스크립트의 이유다.
set -euo pipefail
cd "$(dirname "$0")/.."
GODOT="${GODOT:-$HOME/Applications/Godot.app/Contents/MacOS/Godot}"

want="$(cat .godot-version)"
got="$("$GODOT" --version | cut -d. -f1-3)"
printf '엔진      : 기대 %s / 실제 %s' "$want" "$got"
[ "$want" = "$got" ] && echo "  OK" || { echo "  불일치"; exit 1; }

echo "package.json : $([ -f package.json ] && echo '있다 — 규약 위반, 삭제하라' || echo '없다  OK')"
[ -f package.json ] && exit 1

echo "프로젝트 설정 키 대조:"
"$GODOT" --headless --path . scenes/doctor.tscn
