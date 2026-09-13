extends Node
## 회귀: **구제 창을 이미 화면에 있는 손가락으로 닫을 수 있는가.**
##
## 실기 로그 23/23 사망에서 rpress=0 이 22건, 나머지 1건도 존 밖이었다. 이 게임은
## 드래그로 조종하므로 피격 순간 엄지는 이미 닿아 있고, **이미 눌린 손가락은 press 를
## 만들지 않는다.** 그래서 "창 안에 폭탄을 눌러라" 는 실제로 "0.5초 안에 두 번째
## 손가락을 새로 내려놓아라" 였고 한 손 세로 플레이에서 불가능에 가까웠다.
##
## 이 러너가 지키는 것은 세 줄이다:
##   A 무입력이면 죽는다        — 구제는 공짜가 아니다
##   B 들고 있던 손을 떼면 산다 — 이미 닿은 손가락이 할 수 있는 유일한 동작
##   C 화면 아무 데나 눌러도 산다 — 창 동안 존은 없다(rzone=0 이 유일한 press 를 버렸다)

var _fail := 0
var _m: Main = null
var _sh: Shell = null

func _touch(idx: int, p: Vector2, pressed: bool) -> void:
	var e := InputEventScreenTouch.new()
	e.index = idx; e.position = p; e.pressed = pressed
	get_viewport().push_input(e, true)

func _btn_rect(id: int) -> Rect2:
	_sh.layout()          # dry 로 _draw() 를 돌려 버튼 사각형만 채운다(트리 밖 draw_* 금지)
	for b in _sh._btns:
		if int(b[1]) == id:
			return b[0] as Rect2
	return Rect2()

func _tap(p: Vector2) -> void:
	_touch(0, p, true)
	_touch(0, p, false)

func _steps(n: int) -> void:
	for i in n:
		await get_tree().physics_frame

func _check(name: String, ok: bool, got: String) -> void:
	if ok:
		print("  PASS  %s — %s" % [name, got])
	else:
		_fail += 1
		print("  FAIL  %s — %s" % [name, got])

## 드래그 손가락 하나를 기체 위치에 올린 채 피격시킨다(실제 플레이의 형태).
func _open_window() -> void:
	TouchRouter.clear_touches()
	_touch(0, _m.player, true)
	await _steps(3)
	_m._on_hit()
	await get_tree().physics_frame

## 사망 뒤 새 런으로 들어간다 — **실제 경로다.** _m._restart() 를 직접 부르면
## finish_run(false) 가 런을 끝내 RESULT 로 가고, 그 뒤의 press 는 Shell 이 먹어
## TouchRouter 까지 오지 않는다(touches=0). 그러면 아래 판정이 전부 거짓 FAIL 이 된다.
func _replay_run() -> void:
	if _sh.screen != Shell.Screen.RESULT:
		return
	_tap(_btn_rect(0).get_center())
	await get_tree().process_frame
	await _steps(30)

func _ready() -> void:
	SaveData.reset_for_test("user://save-rescuereg.json")
	await get_tree().process_frame
	_m = load("res://src/main.gd").new()
	_m.stage_full = true
	add_child(_m)
	await get_tree().process_frame
	_sh = _m._shell
	_sh.screen = Shell.Screen.TITLE
	# TITLE → PILOT → DIFF → PLAY. PILOT 단계를 빼먹으면 Difficulty.Level.NORMAL(=0) 이
	# 파일럿 0 으로 소비되어 DIFF 에서 멈춘다 — 그 아래 판정은 전부 거짓이 된다.
	_tap(_btn_rect(0).get_center())                                  # TITLE: PLAY
	await get_tree().process_frame
	_tap(_btn_rect(Cast.Pilot.NARIN).get_center())                   # PILOT: 나린
	await get_tree().process_frame
	_tap(_btn_rect(Difficulty.Level.NORMAL).get_center())            # DIFF: Normal
	await get_tree().process_frame
	await _steps(30)
	print("구제 창 회귀 — screen=%d(PLAY=%d) bombs=%d lives=%d sim=%d"
			% [_sh.screen, Shell.Screen.PLAY, _m.bombs, _m.lives, SimClock.sim_tick])
	assert(_sh.screen == Shell.Screen.PLAY, "PLAY 진입 실패 — 이 아래 판정은 전부 무의미하다")

	# ── A. 무입력 → 죽는다 ───────────────────────────────────────────────
	var lives0 := _m.lives
	var bombs0 := _m.bombs
	await _open_window()
	await _steps(Tune.RESCUE_TICKS + 6)
	_check("A 무입력이면 사망", _m.lives == lives0 - 1 and _m.bombs == bombs0,
			"lives %d→%d, bombs %d→%d" % [lives0, _m.lives, bombs0, _m.bombs])

	await _replay_run()

	# ── B. 들고 있던 손을 떼면 산다 ──────────────────────────────────────
	lives0 = _m.lives
	bombs0 = _m.bombs
	await _open_window()
	_touch(0, _m.player, false)            # **이미 닿아 있던 손가락을 뗀다**
	await _steps(4)
	_check("B 떼기로 구제", _m.lives == lives0 and _m.bombs == bombs0 - 1
			and SimClock.state == SimClock.State.RUN,
			"lives %d, bombs %d→%d, state=%d" % [_m.lives, bombs0, _m.bombs, SimClock.state])
	await _steps(Tune.RESCUE_TICKS + 6)
	await _replay_run()

	# ── C. 화면 상단 아무 데나 눌러도 산다(창 동안 존은 없다) ────────────
	lives0 = _m.lives
	bombs0 = _m.bombs
	await _open_window()
	_touch(1, Vector2(60.0, 120.0), true)  # 덱이 아니라 화면 최상단
	await _steps(4)
	_check("C 존 밖 press 로 구제", _m.lives == lives0 and _m.bombs == bombs0 - 1
			and SimClock.state == SimClock.State.RUN,
			"lives %d, bombs %d→%d, state=%d" % [_m.lives, bombs0, _m.bombs, SimClock.state])

	print("rescue-regression: %s (%d fail)" % ["OK" if _fail == 0 else "FAIL", _fail])
	get_tree().quit(_fail)
