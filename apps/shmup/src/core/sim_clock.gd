extends Node
## 게임 시간의 유일한 소유자.
## Engine.get_physics_frames() 도 Engine.time_scale 도 쓰지 않는다 —
## time_scale 은 _physics_process 의 delta 를 가변으로 만들어 고정 dt 전제를 파괴하고
## Timer·Tween·파티클까지 전역 오염시킨다. 히트스톱은 정수 틱 게이팅으로 대체한다.

enum State { RUN, HITSTOP, DEATH_REPLAY, DEATH_FROZEN }

var sim_tick: int = 0            ## 우리 소유의 게임 시간. 리셋 시 0 으로 돌아간다.
var wall_tick: int = 0           ## 연출·입력용. 시뮬이 멈춰도 계속 돈다.
var state: int = State.RUN
var hitstop_left: int = 0
var run_index: int = 0
var run_seed: int = 0

## 시뮬이 이번 틱에 전진하는가. 연출은 이것과 무관하게 _process 에서 계속 돈다 —
## 이게 "멈췄는데 살아 있는" 타격감의 정체다.
func sim_advances() -> bool:
	return state == State.RUN

func begin_tick() -> void:
	wall_tick += 1
	if state == State.HITSTOP:
		hitstop_left -= 1
		if hitstop_left <= 0:
			state = State.DEATH_REPLAY
	elif state == State.RUN:
		sim_tick += 1

func hitstop(ticks: int) -> void:
	hitstop_left = ticks
	state = State.HITSTOP

func reset(seed_value: int) -> void:
	sim_tick = 0
	state = State.RUN
	hitstop_left = 0
	run_index += 1
	run_seed = seed_value
