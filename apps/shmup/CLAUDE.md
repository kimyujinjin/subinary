# apps/shmup — LUMEN DRIFT

Godot 4.7.2 · GDScript 전면 정적 타입 · 이 저장소의 pnpm/turbo 파이프라인과 완전 독립.

## 규약 3줄 — 어기면 조용히 깨진다

1. **탄은 노드가 아니라 배열 인덱스다.** BulletField 가 SoA Packed 배열로 전체 탄을 소유한다.
   프레임 중 append/remove_at 금지, 제거는 swap-with-last.
2. **Resource 는 런타임 읽기 전용이다.** `load()` 는 경로당 한 인스턴스를 돌려주므로
   `def.hp -= dmg` 한 줄이 그 적 타입 전체를 오염시킨다. duplicate() 도 답이 아니다.
   가변 상태는 전부 별도 SoA.
3. **apps/shmup 에 package.json 을 절대 만들지 않는다.** 생기는 순간 turbo/pnpm 에 편입되어
   "빌드 완전 독립" 확정사항이 무효가 된다.

## 게이트 3줄

- **게이트 1 통과 전에는** 패턴 4종째·기체 2종째·난이도 2단째·MultiMesh·셰이더·Resource·
  UI 화면·사운드를 만들지 않는다.
- **판정은 실기 release 빌드에서만 유효하다.** 에디터(debug) 실행은 1.6~1.9배 느리다.
- **성능은 추측하지 않는다.** 탄 루프가 실기 release 에서 4ms 를 넘길 때까지 백엔드 논의 없음.

## 결정론

모든 게임 로직은 `_physics_process` 안, `dt` 는 인자가 아니라 `const DT := 1.0/60.0`.
게임 시간은 우리 소유의 `sim_tick: int`. `Engine.time_scale` · `await create_timer()` ·
`Tween` · `Timer` 를 시뮬에 쓰지 않는다.

## 도구

```bash
scripts/doctor.sh        # 엔진 버전 + 프로젝트 설정 키 대조 (키 이름이 틀리면 Godot 은 조용히 무시한다)
scripts/fairness.sh      # 1D 공정성 스캔. exit 1 = 패턴 저작 규칙 위반
GODOT=... godot --headless --path . scenes/soak.tscn   # 30초 루프 5회 — 탄 누적 확인
../../scripts/pull-shmup-runlog.sh {ios|android|local}  # 실기 CSV → 게이트 1 판정
```

```bash
scripts/export-ios.sh debug     # 서명된 .ipa + 프로파일 만료·서명 자동 확인
```

캡처: `godot --path . -- --capture=<틱|w틱>:<경로.png>` — 지표 ④(Weber 콘트라스트)용.
`w` 접두는 벽시계 틱(사망 교재 캡처용). 캡처 모드는 무적이 켜진다
(입력 없는 실행은 첫 벽에 죽어 sim_tick 이 멈춘다).

## iOS export 가 메시지 없이 실패하는 함정

`rendering/textures/vram_compression/import_etc2_astc` 가 꺼져 있으면
Godot 은 `configuration errors:` 뒤에 **아무 메시지도 없이** export 를 거부한다.
근거 — 4.7.2 소스 `editor/export/editor_export_platform_apple_embedded.cpp`:

```cpp
if (!ResourceImporterTextureSettings::should_import_etc2_astc()) {
    valid = false;          // r_error 를 채우지 않는다
}
```

기본값이 false 라 새 프로젝트는 항상 여기 걸린다. `scripts/doctor.sh` 가 이 값을
대조 목록에 넣어 다시 꺼지지 않게 한다. 나머지 실패 모드의 점검 순서는
`scripts/export-ios.sh` 가 실패 시 출력한다.

## 실측된 플랫폼 사실

| 항목 | 값 |
|---|---|
| Apple Developer Program | **유료 유효** (프로파일 365일·기기 3대, 2026-09-09 발급) |
| Team ID | `YDQ6FSA38K` · Apple Development: SooBeen Lee |
| 번들 ID | `dev.subinary.lumendrift` (잠정 — 제목 확정 시 변경) |
| MinimumOSVersion | 16.0 (Metal 요구. 기존 앱의 15.0 을 그대로 쓰면 안 된다) |
| 기기 | iPhone 14 · iPhone 16 · iPad 10세대. **16:9 없음** → `--force-16x9` 로 대체 검증 |
| stretch 실측 | expand 는 자르지 않는다. 폰은 720×1555~1562, iPad 는 **889×1280**(폭이 늘어난다) |

## 측정으로 고른 값 — 추측한 값이 아니다

| 값 | 결정 근거 |
|---|---|
| P01 arc 160° · 11발 · 42틱 | 격자 스윕 36조합. 13/15발은 통로min 32~46 + 정지창 위반 120~220 |
| P01 vy 하한 = speed×0.55 | 순수 방사 부채는 극단 각도 vy=40 u/s → 28초 잔류 → 루프 넘어 누적 |
| P07 pitch 144 · 방출 14틱 | 방출 주기 × VY / 60 이 밴드 높이(32)를 넘어야 줄이 끼어들지 않는다. 12틱=33.0 → 위반 339 |
| 포자낭 HP 240 | 40 이면 관통 자탄에 0.9초에 죽어 격자가 화면에 안 나온다 |
| 포자낭 하강 150 u/s | 62 면 첫 탄이 t=360(5.5초). 30초 루프를 판정하는데 5.5초 공백은 무의미하다 |
| 두 번째 P01 쌍 시차 84틱 | 42틱은 t1485 에 정지창 3건. 84틱은 실패 0 |
| 공정성 스캔 = 차분 배열 | 셀 단위 마킹은 O(탄×폭). 400탄에서 12배 차이가 그대로 프레임타임이다 |

**요구 이동량 지표는 신뢰하지 않는다** — 1D 스캔으로 정의에 4번 실패했다.
근거는 `tools/corridor.gd` 주석. 진짜 요구 이동량은 실기 RunLog 의 플레이어 궤적으로 잰다.
