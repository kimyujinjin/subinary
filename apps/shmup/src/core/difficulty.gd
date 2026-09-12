class_name Difficulty
## 난이도는 HP 가 아니라 **훅 파라미터 자체**다(설계서 §7). 그래서 난이도가 올라가면
## 숫자가 커지는 게 아니라 최적 전략이 바뀐다 — 조류 주기가 8초에서 6초가 되면
## "반전을 기다렸다 건넌다" 가 "반전 전에 건너 둔다" 로 바뀐다.
##
## 오토로드를 쓰지 않는다(4개 상한: SimClock·TouchRouter·BulletField·RunLog).
## static var 는 프로세스 전역이고, 난이도는 런 시작 전에 한 번 정해져 런 도중 안 바뀌므로
## 결정론에 무해하다 — 시드처럼 런의 상수다.
##
## MVP 출시 난이도는 Normal + Hard 2단이다. Easy·Lunatic 은 **표에만 넣어 두고** 노출하지 않는다:
## 구현은 배율로 싸지만 공정성 검증·튜닝·플레이테스트가 4배이고 테스터가 개발자 본인 하나다.

enum Level { EASY, NORMAL, HARD, LUNATIC }
const NAMES := ["Easy", "Normal", "Hard", "Lunatic"]

## 조류 — 이 셋이 "최적 전략이 바뀐다" 를 만드는 축이다.
const U_MAX := [55.0, 90.0, 110.0, 130.0]
## 세그먼트 [우, 정, 좌, 정]. 합이 주기다. 좌우 대칭이어야 한 주기 적분이 0 이 되고,
## 그래야 flow_phase 가 누산기 없이 닫힌다 — 대칭을 깨면 조류 띠가 드리프트한다.
const SEGS := [[225, 135, 225, 135], [150, 90, 150, 90], [113, 67, 113, 67], [94, 56, 94, 56]]
const RAMP := [60, 24, 18, 12]

## 탄막 배율.
const COUNT_M := [0.7, 1.0, 1.2, 1.4]
## 탄속 축은 **이 게임에서 거꾸로 작동해서 껐다.** 설계서 표는 [0.85, 1.0, 1.1, 1.25] 였다.
##
## 실측(tools/zone_runner.gd -- --axes, 구역 3·5 도달폭@300):
##   Normal 기준        Z3 90  Z5 66
##   조류만 Hard        Z3 69  Z5 53   ← 가장 강한 축
##   탄 수만 Hard       Z3 67  Z5 66
##   발사간격만 Hard     Z3 64  Z5 66
##   탄속만 Hard(1.1)   Z3 82  Z5 93   ← **넓어진다**
##   Hard 전체          Z3 77  Z5 94   ← 탄속이 나머지 셋을 전부 먹었다
##   Hard − 탄속(1.0)   Z3 65  Z5 58   ← 네 지표가 전부 좁아진다
##
## 이유는 이 게임의 기제 자체다. 난이도는 조류에서 오고, 조류는 **탄이 밴드에 머무는 동안**
## 민다. 탄을 빠르게 만들면 밀릴 시간이 줄어 조류가 약해진다 — 핵심 기제를 끄는 축이다.
## 같은 논리로 Easy 의 0.85(느린 탄)는 Easy 를 더 어렵게 만든다.
##
## 곱셈 자체는 남겨 둔다(spawn_acc 한 줄). 나중에 다른 축과 묶어 다시 재고 싶을 때를 위해서다.
const SPEED_M := [1.0, 1.0, 1.0, 1.0]
const RATE_M := [1.3, 1.0, 0.85, 0.75]      ## 발사 **간격** 배율 — 작을수록 자주 쏜다

## 공정성 게이트의 최소 통과 폭. 설계서 표는 중심간 D 이고 스캔은 자유 폭 F = D − 32 다
## (CLAUDE.md: 단위를 섞어 비교하면 게이트가 통째로 32유닛 엄격해진다).
const PASS_D := [140, 96, 88, 76]

## 아직 안 쓰는 축 둘 — 표에만 있다.
##   AIMED    Aimed 빈도. 이미터별 메타데이터가 있어야 하는데 패턴이 아직 Resource 가 아니다
##            (4단계를 의도적으로 건너뛰었다). 배율로 흉내 내면 P03 침어의 교재("흰 얇은 탄
##            = 직선·조준")가 난이도에 따라 거짓이 된다 — 가르치는 문장을 흔드느니 미룬다.
##   MAX_TIER 레이어 드롭. tier > max_tier 인 이미터를 베이크 때 제거하는 구조인데
##            베이크 단계 자체가 없다. 그리고 Normal(2) → Hard(3) 은 레이어를 **더하는**
##            방향이라 새 콘텐츠 저작이 필요하다 — 재미 판정 전에 할 일이 아니다.
const AIMED := [0.3, 0.6, 0.85, 1.0]
const MAX_TIER := [1, 2, 3, 4]

static var level: int = Level.NORMAL
static var u_max: float = 90.0
static var ramp: int = 24
static var count_m: float = 1.0
static var speed_m: float = 1.0
static var rate_m: float = 1.0
static var segs := PackedInt32Array([150, 90, 150, 90])
static var period: int = 480

static func apply(lv: int) -> void:
	level = clampi(lv, 0, 3)
	u_max = U_MAX[level]
	ramp = RAMP[level]
	count_m = COUNT_M[level]
	speed_m = SPEED_M[level]
	rate_m = RATE_M[level]
	segs = PackedInt32Array(SEGS[level])
	period = 0
	for s in segs:
		period += s

static func name_of() -> String:
	return NAMES[level]

## 공정성 판정의 자유 폭 하한.
static func free_floor() -> int:
	return PASS_D[level] - 32

## 발사 간격을 난이도로 조정한다. 0 이 되면 매 틱 발사가 되어 패턴이 벽이 되므로 1 이 하한이다.
static func every(base: int) -> int:
	return maxi(1, int(round(float(base) * rate_m)))

## 탄 수. 링 패턴에서는 이것이 곧 틈의 각폭이므로 이 축이 공정성에 직접 닿는다.
static func count(base: int) -> int:
	return maxi(1, int(round(float(base) * count_m)))

## 짝수로 강제되는 탄 수. P13 은 게이트 2개가 **정반대**에 있어야 하고(g1 = g0 + N/2)
## 홀수면 그 성질이 깨진다 — 26 × 1.2 = 31.2 → 31 이 되어 게이트가 어긋난다.
static func count_even(base: int) -> int:
	var c := count(base)
	return c + (c & 1)

## 인자 문자열 → 레벨. 러너와 게임이 같은 파서를 쓴다.
static func parse(s: String) -> int:
	var t := s.to_lower()
	for i in NAMES.size():
		if t == NAMES[i].to_lower():
			return i
	return Level.NORMAL


## `-- --diff=hard` 를 읽어 적용한다. 게임과 모든 러너가 이 함수 하나를 쓴다 —
## 러너마다 파서를 두면 한 러너만 Normal 로 재고 그 숫자로 Hard 를 통과시킨다.
static func apply_from_cmdline() -> void:
	var args := OS.get_cmdline_user_args()
	args.append_array(OS.get_cmdline_args())
	for a in args:
		if a.begins_with("--diff="):
			apply(parse(a.substr(7)))
			return
	apply(Level.NORMAL)
