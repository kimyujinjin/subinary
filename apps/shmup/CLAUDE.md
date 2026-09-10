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
scripts/run-android.sh debug    # export → 설치 → 기동 → 기기 사양 기록
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

## iOS 시뮬레이터로는 기동 확인조차 안 된다 (시도하지 말 것)

`generate_simulator_library_if_missing` 가 만드는 시뮬레이터 슬라이스는 기기 라이브러리에서
생성한 대체물이라 실제로 링크되지 않는다 — `ld: Undefined symbols: _main (arm64)`.
슬라이스 안에 `_main` 은 있지만 아키텍처가 맞지 않는다.

설계서가 이미 시뮬레이터를 판정 면에서 제외했고(Metal/Vulkan 미지원으로 Compatibility 로
떨어져 가독성 판단이 틀린다), 링크조차 안 되므로 **크래시 스모크 테스트도 실기 전용**이다.

## Android 는 블로커가 4건이 아니라 0건이었다

설계서는 "cmdline-tools 없음 · JDK 17 없음 · build-tools 35.0.1 없음 · platforms android-35 없음"
4건을 블로커로 적었다. 그건 **Gradle 커스텀 빌드 경로**의 요구사항이고,
기본 export(prebuilt 템플릿) 경로는 4.7.2 소스 확인 결과 이것만 본다:

| 검사 | 근거 (platform/android/export/export_plugin.cpp) | 상태 |
|---|---|---|
| `android_debug.apk` 템플릿 | `exists_export_template` | OK |
| `export/android/java_sdk_path` 의 `bin/java` | **존재만 확인 · 버전 검사 없음** | JDK 21 로 OK |
| `export/android/android_sdk_path` 의 `platform-tools/adb` | `FileAccess::exists` | OK |
| `build-tools/<ver>/apksigner` | target_sdk 기준 탐색 | 36.0.0 OK |
| 디버그 keystore | Editor Settings 또는 preset | `~/.android/debug.keystore` |

즉 JDK 17 도 cmdline-tools 도 android-35 도 불필요하다. `gradle_build/use_gradle_build=false`.

## 에디터 설정 파일은 버전별 파일이 진짜다

`~/Library/Application Support/Godot/editor_settings-4.tres` 에 써도 읽히지 않는다.
실제로 쓰이는 것은 **`editor_settings-4.7.tres`** 다. 버전 없는 파일에 쓰면
"A valid Java SDK path is required in Editor Settings" 가 계속 난다.

## builds/ 에 .gdignore 가 있어야 한다

iOS export 산출물의 PNG 가 프로젝트 리소스로 임포트되어 `.godot/` 이 부풀고
다음 export 에 섞여 들어갈 수 있다. Godot 은 `.gdignore` 가 있는 디렉터리를 스캔하지 않는다.

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
