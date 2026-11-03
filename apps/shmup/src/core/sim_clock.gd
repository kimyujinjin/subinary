extends Node
## 게임 시간의 유일한 소유자.
## Engine.get_physics_frames() 도 Engine.time_scale 도 쓰지 않는다 —
## time_scale 은 _physics_process 의 delta 를 가변으로 만들어 고정 dt 전제를 파괴하고
## Timer·Tween·파티클까지 전역 오염시킨다. 히트스톱은 정수 틱 게이팅으로 대체한다.

## RESCUE — 피격 후 폭탄으로 취소할 수 있는 창(20틱). 앞 8틱은 히트스톱이라 시뮬이 멈추고,
## 나머지 12틱은 시뮬이 도는 채로 기체가 무적이다. 창이 끝나면 사망이 확정된다.
## 히트스톱을 창 전체로 늘리지 않는 이유: 창은 벽시계 반응 시간(333ms)이고,
## 정지 프레임은 상황을 읽을 시간이다 — 둘은 다른 목적이다.
enum State { RUN, HITSTOP, RESCUE, DEATH_REPLAY, DEATH_FROZEN }

var sim_tick: int = 0            ## 우리 소유의 게임 시간. 리셋 시 0 으로 돌아간다.
var wall_tick: int = 0           ## 연출·입력용. 시뮬이 멈춰도 계속 돈다.
var state: int = State.RUN
var hitstop_left: int = 0
var rescue_left: int = 0
var bomb_anim: int = -1        ## 폭탄 연출 시계 — 시뮬이 멈춰도 흐른다
var run_index: int = 0
var run_seed: int = 0

## 사망 연출 전용 시계. 시뮬이 멈춘 뒤에도 흐르므로 플래시·링 파동이 살아 있다 —
## 이게 "멈췄는데 살아 있는" 타격감의 정체다.
var death_anim: int = -1

## 시뮬이 이번 틱에 전진하는가. 연출은 이것과 무관하게 _process 에서 계속 돈다 —
## 이게 "멈췄는데 살아 있는" 타격감의 정체다.
func sim_advances() -> bool:
	return state == State.RUN or (state == State.RESCUE and hitstop_left <= 0)

## 피격 → 구제 창을 연다. 창이 끝날 때까지 사망은 확정되지 않는다.
func rescue(ticks: int) -> void:
	state = State.RESCUE
	rescue_left = ticks
	hitstop_left = Tune.RESCUE_HITSTOP

func begin_tick() -> void:
	wall_tick += 1
	if death_anim >= 0:
		death_anim += 1
	if bomb_anim >= 0:
		bomb_anim += 1
	if state == State.RESCUE:
		rescue_left -= 1
		if hitstop_left > 0:
			hitstop_left -= 1
		else:
			sim_tick += 1
	elif state == State.HITSTOP:
		hitstop_left -= 1
		if hitstop_left <= 0:
			state = State.DEATH_REPLAY
	elif state == State.RUN:
		sim_tick += 1

func hitstop(ticks: int) -> void:
	hitstop_left = ticks
	state = State.HITSTOP
	death_anim = 0

func reset(seed_value: int) -> void:
	sim_tick = 0
	state = State.RUN
	hitstop_left = 0
	rescue_left = 0
	death_anim = -1
	bomb_anim = -1
	run_index += 1
	run_seed = seed_value
