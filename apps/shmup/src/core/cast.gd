class_name Cast
## 인물 — 조종사 2명과 보스의 이름·대사·의장명.
##
## **완전히 새로운 IP 다.** 구조(조종사 2명이 서로 다른 사격을 갖는다 · 보스가 전투 전에
## 말한다 · 페이즈마다 이름이 붙는다)는 이 장르의 관습이고, 이름·성격·대사·세계관은 전부
## 이 게임의 것이다 — 심해 생물발광, 조류, 표류광.
##
## 텍스트가 처음으로 게임에 들어온다. 그래서 한글 폰트가 필요해졌고
## "이미지 애셋 0개" 규칙이 여기서 끝난다(폰트도 초상화도 애셋이다).
## 그 대가로 얻는 것: 보스가 생물이 아니라 **인물**이 된다.

## ── 조종사 ──────────────────────────────────────────────────────────────
## 두 사람의 차이는 "무엇을 더 잘 보는가" 다. 그게 사격 폭과 회수 반경으로 나온다.
## 난이도처럼 **HP 가 아니라 파라미터**로 가른다.
enum Pilot { NARIN, HAEMU }
const PILOT_N := 2

const NAMES := ["나린", "해무"]
const ROMAN := ["NARIN", "HAEMU"]
## 한 줄 소개 — 선택 화면에서 이 문장 하나가 차이를 설명해야 한다.
## 장르 문법대로 **두 사람은 성격이 반대**다(과감·욕심 / 정석·절제).
## 상하가 아니라 같은 세계의 두 태도다 — 한쪽이 더 세면 고를 이유가 없어진다.
const TAGLINE := [
	"다 줍는다. 넓게 훑고 멀리 손을 뻗는다.",
	"한 점만 본다. 좁게 겨누고 깊게 뚫는다.",
]
## 두 색 — 한 인물 = 두 색이 이 장르의 규칙이다. 세 색 이상이면 기억되지 않는다.
## 선택 화면과 초상화가 같은 색을 써야 "그 사람" 이 하나로 읽힌다.
const COLOR := [Color(0.35, 0.90, 0.85), Color(0.16, 0.29, 0.55)]
const COLOR2 := [Color(0.92, 0.82, 0.45), Color(0.90, 0.94, 1.00)]
## 사격 2열의 반간격(유닛). 넓으면 스치듯 맞히기 쉽고, 좁으면 한 점에 모인다.
const COL_HALF := [16.0, 4.0]
## 자탄 대미지 배율. 넓은 쪽이 약하다 — 폭과 화력을 동시에 주면 고를 이유가 없어진다.
##
## **차이를 여기서 크게 주면 안 된다.** 처음에 0.85/1.15 로 잡았더니 나린의 보스 킬타임이
## 117.6초가 되어 배정 108초를 넘고 중간보스도 28초를 넘겼다 — **못 끝내는 조종사**가 된다.
## 조종사는 "어떻게 지나가는가" 로 갈려야지 "지나갈 수 있는가" 로 갈리면 안 된다.
## 그래서 화력 차이는 좁히고, 진짜 차이는 사격 폭(조준 방식)과 회수 반경(점수)으로 옮겼다.
const DMG_MULT := [0.95, 1.10]
## 집중 시 추가 배율. 해무는 집중이 곧 정체성이라 더 크게 준다.
const FOCUS_MULT := [1.30, 1.50]
## 광립 회수 반경 배율(graze 링 기준). 나린의 보상이다.
const PICKUP_MULT := [1.6, 1.0]

static var pilot: int = Pilot.NARIN

## `-- --pilot=haemu` 를 읽는다. 조종사가 바뀌면 실효 DPS 가 바뀌고, 그러면 보스 HP 가
## 시간 상한 안에 들어가는지가 바뀐다 — 러너가 조종사를 못 고르면 한 사람 기준으로만 재고
## 그 숫자로 둘 다 통과시킨다(난이도에서 이미 겪은 함정이다).
static func apply_from_cmdline() -> void:
	var args := OS.get_cmdline_user_args()
	args.append_array(OS.get_cmdline_args())
	for a in args:
		if a.begins_with("--pilot="):
			var t := a.substr(8).to_lower()
			for i in ROMAN.size():
				if t == ROMAN[i].to_lower() or t == str(i):
					pilot = i
					return
	pilot = Pilot.NARIN

static func pilot_name() -> String:
	return NAMES[pilot]

static func col_half() -> float:
	return COL_HALF[pilot]

static func dmg_mult() -> float:
	return DMG_MULT[pilot]

static func focus_mult() -> float:
	return FOCUS_MULT[pilot]

## 자탄 한 발의 대미지. **게임과 러너가 이 함수 하나를 쓴다.**
## 러너가 Tune.SHOT_DMG 를 직접 쓰고 있었더니 조종사를 바꿔도 킬타임이 한 자도 안 변했다 —
## 난이도에서 겪은 "계측기가 축을 모른다" 와 같은 부류다.
static func shot_dmg(focused: bool) -> float:
	return Tune.SHOT_DMG * DMG_MULT[pilot] * (FOCUS_MULT[pilot] if focused else 1.0)

## 초당 대미지(정렬 100%% 기준). 볼리당 2발 × 초당 볼리 수.
static func dps(focused := false) -> float:
	return shot_dmg(focused) * 2.0 * 60.0 / float(Tune.SHOT_PERIOD_TICKS)

static func pickup_r() -> float:
	return Tune.GRAZE_R * PICKUP_MULT[pilot]

## ── 보스 ────────────────────────────────────────────────────────────────
## 페이즈 이름은 설계서 §6 이 이미 붙여 둔 것을 그대로 쓴다 — 「점등」·「역상」·「화관」.
## 각 이름이 그 페이즈가 **무엇을 가르치는가**와 일치해야 한다:
## 안전이 시간(점등) → 특정 비트(역상) → 장소(화관)로 바뀌는 것이 이 보스의 학습 곡선이다.
const BOSS_NAME := "화륜종 코로나"
const BOSS_PHASE := ["「점등」", "「역상」", "「화관」"]

## 중간보스. 이쪽은 조류에 회전이 붙는 것이 전부라 이름도 물의 상태를 말한다.
const MID_NAME := "조류 방추체 테르사"
const MID_PHASE := ["「정류」", "「선회」", "「엇갈림」"]

## ── 대사 ────────────────────────────────────────────────────────────────
## 전투 전 몇 줄. 길면 5분 런에서 방해가 되므로 한 쪽당 두 줄을 넘기지 않는다.
## [화자(-1 = 조종사, 0 = 상대), 문장]
const MID_TALK := [
	[-1, "물살이 돌고 있어. 여긴 좌우만이 아니야."],
	[0, "……깊은 쪽에서 왔구나."],
	[0, "내가 도는 동안은, 네 아래도 물이야."],
	[-1, "알아. 그래서 읽으러 왔어."],
]
const BOSS_TALK := [
	[0, "네가 읽어 온 게 전부 나였다."],
	[-1, "조류가 여기서 나온다는 건 알고 있었어."],
	[0, "알면서 내려온 건가."],
	[-1, "읽을 수 있으면 지나갈 수 있으니까."],
]

## 그 대사를 말할 때 띄울 초상화 인덱스. 0·1 = 조종사, 2 = 테르사, 3 = 코로나.
static func portrait_of(speaker: int, opponent: int) -> int:
	return pilot if speaker < 0 else opponent
