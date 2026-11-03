#!/usr/bin/env bash
# 1D 공정성 스캔. exit 1 = MIN_GAP_UNITS 위반.
# 로그를 | tail 로 자르지 않는다 — 이 저장소가 이미 배운 교훈이다.
set -euo pipefail
GODOT="${GODOT:-$HOME/Applications/Godot.app/Contents/MacOS/Godot}"
cd "$(dirname "$0")/.."
"$GODOT" --headless --path . scenes/fairness.tscn
