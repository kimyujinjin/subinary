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

- **게이트 1 은 사용자 판단으로 면제됐다(2026-09-10).** 실기 2판(25런) 뒤 "됐다 치고 다음" 으로
  2단계(보스 L0)에 들어갔다. 게이트 1 의 숫자 5개와 한 문장은 측정되지 않았다 — 나중에 재미
  판정이 흔들리면 여기로 돌아와 스테이지 30초 루프로 판정한다.
- 게이트 2(보스 L0) 판정 전에는 P2·P3·MultiMesh·셰이더·Resource·UI 화면·사운드를 만들지 않는다.
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
godot --headless --path . scenes/invariants.tscn   # 회귀 불변식 (조류 위상 · 첫 바늘 · 다손가락 터치 6종)
godot --headless --path . scenes/onramp.tscn       # 첫 10초 압력 (볼리 수 × 첫 직침어 진입)
godot --headless --path . scenes/input_path.tscn    # 실제 입력 경로 + 보스 격파 → 재시작
godot --headless --path . scenes/boss_scan.tscn    # 보스 P1 성분 진단 + 도달 판정 (≈4분)
godot --path . scenes/boss_rush.tscn               # 보스 러시 직접 실행
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
| Android 실기 | Galaxy S25+ (SM-S942N) · Android 16 · Vulkan 1.4.304 Forward Mobile · Xclipse 960 |
| 실기 가시영역 | 720×1560 (1080×2340). 플레이필드 1280 + 하단 여백 280 → 덱 240 이 여백 안에 들어간다 |
| 실기 프레임 | 121탄 debug: phys 4.60ms · proc 15.95ms · dc 39 · fps 60 (120Hz 패널에서 max_fps 60 적중) |
| gfxinfo | **Godot 프레임을 세지 않는다.** 수 분 플레이 후에도 "Total frames 24" — Android UI 프레임만 센다(Godot 은 SurfaceView 에 그린다). 프레임 판정에 쓰지 말 것. HUD fps·RunLog fps 칼럼·Godot Performance 모니터를 쓴다 |

## 화면 물리 폭은 엔진 API 로 알 수 없다

`DisplayServer.screen_get_dpi()` 는 Android 에서 **논리 density 버킷**을 돌려준다.
Galaxy S25+ 실측: 보고 454~480 → 60mm 인데 실제 `xDpi=409.43` → **67.0mm**. 11~17% 과소보고.

k 는 유닛 공간의 무차원 이득이므로 이 값이 곧 조작감의 척도다. 틀린 mm 로 계산하면
"720유닛 횡단 = 손가락 57.5mm" 라는 k=1.20 의 근거 자체가 틀어진다.
그래서 실측값을 주입한다 — `command_line/extra_args="--screen-mm=67.0"`.
확인: `adb shell dumpsys display | grep xDpi`. HUD 는 주입값이 없으면 `mm?` 로 표시한다.

**Android 의 extra_args 는 `OS.get_cmdline_user_args()` 가 아니라 `get_cmdline_args()` 로 온다.**
두 배열을 모두 봐야 데스크톱의 `-- --flag` 와 실기의 extra_args 가 같이 동작한다.

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

| 통로 유지 시간 지표 | 폭만 보는 1D 스캔이 실기의 "8초 사망"을 통과시켰다. 반응 하한 24틱 |
| 첫 교사 P01 1기 · 볼리 66틱 | 2기 동시 · 42틱은 12런 전부 5~9초에 죽었다 |
| 웨이브 후보 C | A·B·C 전부 실패 0 이지만 B 는 두 밴드가 항상 열려 압력이 0 |
| 첫 교사 4볼리 · 첫 직침어 t=640 | 2차 실기 9~11초 사망 9/25. 첫 바늘 등장 시 잔여 포자 46 → 10 (`scenes/onramp.tscn`) |

## _draw() 안에서 draw_set_transform 은 상태를 남긴다

한 루프에서 회전 탄과 무회전 탄을 섞으면, 회전 탄을 그린 뒤 **다음에 오는 무회전 탄이
그 회전 탄의 위치·회전 좌표계로 변환되어** 그려진다. 루프 끝에서만 리셋하면 늦다.

실기 증상: "총알이 갑자기 변하고 순간이동한다". SoA 에서 바늘의 인덱스가 swap-remove 로
매 프레임 바뀌므로 어느 탄이 틀어지는지도 계속 변한다.
같은 틱 비교로 확인 — 활성 탄 30발 중 제자리에 그려진 것이 13발(버그) 대 20발(수정),
draw call 36 대 25.

**규칙: 탄종을 회전/무회전 두 패스로 나눈다.** 배칭에도 유리하다.

## 사망 교재 중에는 탄 레이어도 다시 그려야 한다

캔버스 아이템은 `queue_redraw()` 전까지 이전 커맨드를 계속 렌더한다. 교재 중에
BulletRenderer 를 재드로우하지 않았더니 사망 프레임의 탄이 얼어붙은 채 남고,
그 위로 0.5초 과거의 교재 탄이 따로 그려져 **모든 탄이 두 벌**로 보였다 —
하나는 정지, 하나는 과거에서 미끄러져 들어온다. 실기 증상 "순간이동" 의 한 축이다.

규칙: 교재 탄은 BulletRenderer 가 리플레이 프레임을 **같은 드로우 경로**(`_draw_set`)로
그리고, FieldOverlay 는 주석(베일·되감기 표식·틈·살해탄 링·궤적)만 그린다.
두 경로가 갈라지면 외형이 갈라진다.

## 화면 스크롤 위상은 속도의 적분이다

조류 띠 눈금 위상을 `tick × c(tick)` 로 계산했더니 램프마다 역주행했다
(d/dt[t·c] = c + t·c′ 에서 t·c′ 가 c 를 압도한다). 불변식 검사 결과 기본 주기 1440틱 중
144틱, 감속 2880틱 중 432틱에서 부호가 거꾸로였다. `BulletField.flow_phase()` 는
닫힌형 적분이다 — 한 주기 적분이 0 이라 누산기도 드리프트도 없다.
`scenes/invariants.tscn` 이 회귀를 막는다.

## 시각 반폭과 판정 반폭을 분리한다

`KIND_W` 는 판정, `KIND_VIS_W` 는 렌더다. 바늘은 판정 1.5유닛 = 2.25px 인데
그 값으로 텍스처를 구우면 **림 두께(2.2) + AA(0.9) = 3.1 유닛이 반폭보다 커서
흰 코어가 아예 생성되지 않는다** — 검은 림만 남고, 사전곱셈에서 rgb≈0·a=0.85 는
배경을 어둡게만 하므로 어두운 배경에서 완전히 투명해진다.

즉 P03 직침이 **보이지 않는 탄**이었다. BulletAtlas 는 림·AA 를 `w * 0.42` / `w * 0.30`
으로 클램프해 얇은 탄에서도 코어가 남게 한다.

## 공정성 도구의 단위 — 자유 폭 F 와 중심간 D

설계서의 통과 폭(최소 32 · Normal 96 · 정지 창 88)은 **탄 중심 사이 거리 D** 다.
1D 스캔이 재는 것은 판정 반경만큼 부풀린 뒤 남는 **자유 폭 F** 이고, 포자 사이에서 F = D − 32.
한동안 F 를 D 기준값과 그대로 비교해 모든 게이트가 32유닛 엄격했다. 스테이지 판정은 그만큼
보수적이었을 뿐이지만(앞서 적은 "최장 104~112" 는 D 로 136~144), 보스 판정은 결론이 뒤집혔다.
기준값은 `Tune.FREE_*` 로 둔다. 새 도구에서 D 상수를 F 와 비교하지 말 것.

통로 유지 시간도 측정 끝에 닿아 잘린(censored) 구간을 세면 "@t2999 유지 1틱" 이 최단값이 된다.
`Corridor.hold_times` 는 시작·끝에 닿은 구간을 뺀다.

## 격자·이동하는 벽은 Reach1D 로 판정한다

통로 유지 시간은 "지금 있는 통로가 오래 열리는가" 를 묻는다. 벽-틈(P01·P07)에는 맞지만,
틈이 매 줄 옮겨 가는 벽(P09)·회전 격자(P05)에서는 플레이어가 원래 옆 통로로 옮겨 가야 하므로
판정 기준이 맞지 않는다(P05 단독 — 가장 고전적인 링 — 이 유지 2틱으로 "불공정" 이 나왔다).
`tools/reach1d.gd` 는 고정 밴드에서 `R(t+1) = dilate(R(t), v) ∩ free(t+1)` 을 돌려
"횡속도 v 로 계속 살아남을 경로가 있는가" 와 "최악 순간의 도달 가능 폭(정밀도 요구)" 을 낸다.
설계서가 기각한 2D BFS 가 아니다 — 720칸 비트맵 점화식이고 손 계산 케이스 6개로 검증한다.
y 방향 회피를 쓰지 않으므로 보수적이다.

## 보스 L0 (`scenes/boss_rush.tscn`)

- main.gd 를 `boss_mode = true` 로 쓴다. 틱 순서·판정·교재·계측을 공유한다 — 두 벌로 가르면
  한쪽에서 고친 결함이 다른 쪽에 남는다
- 링 각도 = ω · flow_phase, 압력/호흡 창 = flow_seg. 리듬을 따로 두지 않는다 → 불변식이 보장
- 자탄은 보스 코어에서 **한 발 = 1** 로 소모한다. 관통 판정을 쓰면 판정 반경 70 에서 한 발이 7 을 넣는다
- 장면 전환: 최상단 64유닛을 0.5초 안에 세 번 탭(데스크톱 B 키)
- 값: ω 0.30 · P05 탄속 200 (`scenes/boss_scan.tscn` — 성분별 진단 + 9조합 도달 판정)

## 이벤트를 소비하면 그 손가락의 **전부**를 소비해야 한다

최상단 띠 제스처가 press 만 소비하고 drag 를 흘렸더니, TouchRouter 의 `_touch` 에
화면에 없는 손가락이 유령으로 남고 다음 재파지에서 릴레이가 그리로 넘어가 **기체가
영구히 멈췄다**(드래그 100px 에 x 408 → 408). 소비는 index 단위로 한다 — press 를 가져간
index 를 기록하고 그 index 의 drag·release 만 함께 소비한다. release 는 좌표로 판단하지
않는다(iOS 는 (-1,-1) 로 보낸다). TouchRouter 쪽에도 2차 방어선을 뒀다: press 를 못 본
index 의 drag 는 무시한다.

## 예고와 실제 발사는 같은 술어에서 나와야 한다

보스 발광 기관 예고를 창 국소 틱(`P05_EVERY - l % P05_EVERY`)으로 계산했더니 두 방향으로
틀렸다 — 압력 창 끝에서는 오지 않는 발사를 예고하고, 창 첫 발사는 예고 없이 터졌다
(틱 1~999 의 19발 중 5발 무예고 · 4구간 유령 예고). `Boss.p05_fires(tick)` 하나를 두고
`step()` 과 `organ_glow()` 가 함께 쓴다. 불변식이 무예고 0 · 유령 0 을 지킨다.

## 다손가락 로직은 헤드리스에서 검증한다

맥의 합성 터치는 index 0 하나뿐이라 릴레이 인계·재시작 탭·사망 화면 해제 같은
다손가락 경로를 에디터로 재현할 수 없다. `InputEventScreenTouch`/`ScreenDrag` 를 만들어
`TouchRouter._unhandled_input()` 에 직접 넣으면 된다 — `tools/invariants_runner.gd` 의
`_touch_cases()`. 실기는 "손에 어떻게 느껴지는가" 만 판정하게 남긴다.

단, 그 방식은 `TouchRouter._unhandled_input()` 을 직접 부르므로 **상위 노드가 이벤트를 먼저
소비하는 경로를 못 본다** — 위의 유령 터치 결함이 정확히 그 사각지대였다.
`scenes/input_path.tscn` 은 실제 씬을 띄우고 `Viewport.push_input` 으로 넣는다.
보스 격파 → 재시작 경로도 여기서 검증한다(무조작 헤드리스 런은 50초 전에 죽어
스모크 테스트로는 그 경로가 실행되지 않는다).

## RunLog 의 detail 칼럼

마지막 칼럼 `detail` 은 `key=value;key=value` 자유 형식이다. 새 계측마다 헤더를 바꾸지
않기 위해서다. 헤더가 바뀌면 `run_log.gd` 가 기존 파일을 `runlog-<unix>.old.csv` 로
치우고 새로 쓴다 — 헤더가 다른 파일에 이어 쓰면 칼럼이 어긋나 판정이 조용히 틀린다.
`ev=regrip` 행은 떼는 순간의 손가락 위치·누른 시간·축별 도달 여유를 남기고,
verify 가 원인(제외 영역 / 도달 소진 / 짧은 드래그 / 기타)을 집계한다.

## 1D 스캔은 "틈이 열려 있는 시간"을 보지 않는다

실기 첫 판에서 12런 전부 5~9초에 P01 로 죽었고 P07 격자까지 도달한 런이 0건이었다.
그런데 공정성 스캔은 실패 0 · 경고 0 이었다. 로그를 보니
사망 순간 최장 자유 구간이 144~352유닛이고 플레이어 궤적도 x 24~555 로 정상 —
**공간은 있었는데 통과하지 못했다.**

폭만 보는 지표는 그 상황을 통과시킨다. 그래서 `tools/corridor.gd` 에
통로 유지 시간(`hold_times`)을 넣었다 — 통과 폭 이상으로 연속 열려 있던 구간의 길이다.
하한은 24틱(400ms): 단순 시각 자극 반응 중앙값 250~300ms + 엄지 전이 60~100ms.
넣자마자 웨이브 합성이 **유지 1틱 · 2틱**으로 실패했다. 그게 8초 사망의 정체였다.

교훈: 판정 도구가 통과시켰다는 것은 그 축을 봤다는 뜻이 아니다.

**요구 이동량 지표는 신뢰하지 않는다** — 1D 스캔으로 정의에 4번 실패했다.
근거는 `tools/corridor.gd` 주석. 진짜 요구 이동량은 실기 RunLog 의 플레이어 궤적으로 잰다.
