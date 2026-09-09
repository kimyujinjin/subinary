class_name Tune
## 게이트 1 슬라이스의 모든 수치. 설계서 §3·§4·§8 에서 옮긴 값이며 실기 판정으로만 바뀐다.
## 여기 없는 값을 코드에 인라인하지 않는다 — 튜닝 대상이 코드에 흩어지면 판정이 불가능해진다.

# ── 시간 ────────────────────────────────────────────────────────────────
# dt 는 _physics_process 의 인자가 아니라 상수다. 가변 delta 는 고정 dt 전제를 파괴한다.
const DT := 1.0 / 60.0
const TPS := 60

# ── 좌표계 ──────────────────────────────────────────────────────────────
# stretch = canvas_items + expand, base 720×1280. 폭은 모든 폰에서 정확히 720유닛이고
# 높이만 1280(16:9)~1680(21:9)로 변한다. 플레이필드는 상단 정렬, 남는 하단이 손가락 영역.
const PF_W := 720.0
const PF_H := 1280.0
const MARGIN := 24.0            # 안전영역과 max() 로 감싸는 우리 최소 마진

# 컨트롤 덱 — 뷰포트 절대 하단 240유닛 (플레이필드 기준이 아니다)
const DECK_H := 240.0
# 역할 배정 제외 — 무지구 접촉 + iOS 홈 인디케이터 34pt + Android 제스처 내비 48px
const EXCL_SIDE := 90.0
const EXCL_BOTTOM := 40.0

# ── 조작 ────────────────────────────────────────────────────────────────
# k 는 유닛 공간의 무차원 이득. 720유닛 횡단 = 손가락 600유닛 = 57.5mm (69mm 폭 기준).
const K_NORMAL := 1.20
const K_FOCUS := 0.54           # 1.20 × 0.45
const K_DWELL_TICKS := 5        # 90ms — 즉시 2.5배 점프 금지
const K_RAMP_TICKS := 6         # 100ms 선형 램프 (시뮬 상태이므로 결정론에 무해)

# 집중 = 드래그 손가락 이중탭 래치. 하단 홀드 방식은 무지구 오접촉으로 k 가 무성 반전된다.
const TAP_WINDOW_TICKS := 14    # 240ms
const TAP_HOLD_MAX_TICKS := 10  # 이보다 길게 누르면 탭이 아니라 드래그다
const TAP_MOVE_MAX := 8.0       # 12px @ 1.5px/unit

# 엣지 푸시 — 필수 기능. 손가락이 화면 끝에 닿으면 drag 이벤트가 아예 오지 않아
# 기체가 조용히 멈추고, 그 소진이 벽·구석의 최고 압력 순간에 결정론적으로 발생한다.
const EDGE_BAND := 27.0
const EDGE_PUSH := 300.0
const EDGE_RAMP_TICKS := 5      # 80ms
const MAX_STEP_PER_TICK := 40.0 # limit_length 클램프

# ── 플레이어 ────────────────────────────────────────────────────────────
const PLAYER_R := 4.0           # 판정 반경. 기체 2종이 동일하다 (공정성 검증을 2번 하지 않는다)
const GRAZE_R := 20.0
const SHIP_VIS := 13.0          # 시각 반경 — 판정과 분리
const SHOT_PERIOD_TICKS := 8    # 7.5발/초 (설계 8발/초의 정수 근사)
const SHOT_SPEED := 1200.0
const SHOT_COL_HALF := 7.0      # 폭 14유닛 2열
const SHOT_R := 3.0
const SHOT_DMG := 1.0

# ── 탄종 ────────────────────────────────────────────────────────────────
# 실루엣이 거동을 예약한다. 게이트 1 은 2문법만 — 휘는 것(포자)과 안 휘는 것(바늘).
enum Kind { SPORE_TIDE, SPORE_GRID, NEEDLE }
const KIND_N := 3
const KIND_W    := [12.0, 12.0, 1.5]    # 반폭 — 판정은 (w + PLAYER_R)
const KIND_H    := [ 0.0,  0.0, 11.0]   # 반길이 — 캡슐 축 방향
const KIND_TAU  := [0.45, 0.45,  0.0]   # 0.0 = 조류 면역 (τ = ∞)
const KIND_QUAD := [20.0, 20.0, 14.0]   # 쿼드 반경 ≤ 히트 반경 × 2.0. fill rate 가 병목이다
const KIND_HALO := [ 8.0,  8.0,  0.0]   # 바늘은 헤일로 없음
const KIND_TRAIL := [0.17, 0.17, 0.11]  # 잔광 궤적선 길이(초). 포자는 곡률이 보여야 하므로 길다

# ── 조류장 (항력 이완 모델) ──────────────────────────────────────────────
# v_x' = (u(y,t) − v_x) / τ. 원안의 전역 가속 모델은 a_x 에 x 의존성이 없어
# 패턴을 평행이동시킬 뿐 기울이지 못했다 (실제 기울기 0.6°).
const FLOW_U_MAX := 90.0
const FLOW_PERIOD := 480        # 8s — 우 2.5 → 정 1.5 → 좌 2.5 → 정 1.5
const FLOW_SEGS := [150, 90, 150, 90]
const FLOW_LEVELS := [1.0, 0.0, -1.0, 0.0]
const FLOW_RAMP := 24           # 0.4s
# 강등 경로 (게이트 1 지표 ② 미달 시): 감속이다. 상수화하면 6개 설계 결정이 함께 죽는다.
const FLOW_SLOW_PERIOD := 960
const FLOW_SLOW_U_MAX := 55.0
const FLOW_SLOW_RAMP := 72
# S(y) = 0.6 + 0.4·sin(πy/1280) — 화면 중앙이 가장 빠르다
const FLOW_S_BASE := 0.6
const FLOW_S_AMP := 0.4

# ── 공정성 ──────────────────────────────────────────────────────────────
# 세로 스크롤에서 실제로 필요한 판정은 "플레이어 y 밴드에서 x 축 자유 구간의 최댓값"이다.
# 2D 도달가능성 BFS 는 틀려도 "통과했다"고 보고하는 종류의 도구라 넣지 않는다.
const MIN_GAP_UNITS := 32       # 기하학적 하한 — 하드 assert. 2×(포자 시각반경 12 + 히트반경 4)
const GAP_NORMAL := 96.0        # Normal 최소 통과 폭 (중심간)
const BAND_HALF := 16.0
const SCAN_CELLS := 720

# ── 사망 교재 ───────────────────────────────────────────────────────────
const REPLAY_TICKS := 30        # 0.5초 되감기
const REPLAY_MAX := 512

# ── 상한 ────────────────────────────────────────────────────────────────
const MAX_BULLETS := 4096       # 최초 1회 resize 후 재할당 금지
const MAX_PSHOTS := 128
const MAX_ENEMIES := 32
const CAP_NORMAL := 400         # 게임플레이 상한. 3,000 은 stress.tscn 전용 보험이다

# ── 색 (심해 / 생물 발광) ────────────────────────────────────────────────
const COL_ABYSS_TOP := Color(0.020, 0.055, 0.086)
const COL_ABYSS_BOT := Color(0.008, 0.020, 0.035)
const COL_TIDE := Color(0.949, 0.376, 0.443)     # 적조 — 포자
const COL_GRID := Color(0.310, 0.847, 0.816)     # 발광 격자 — 포자
const COL_NEEDLE := Color(0.949, 0.984, 0.980)   # 바늘 — 흰 코어
const COL_PSHOT := Color(0.549, 0.902, 1.000)
const COL_SHIP := Color(0.855, 0.949, 0.945)
const COL_ENEMY := Color(0.427, 0.318, 0.475)
const COL_FLOW := Color(0.310, 0.847, 0.816)
