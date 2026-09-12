extends Node
## 실제 입력 경로 검증 — Viewport.push_input 으로 넣는다.
##
## invariants_runner 는 TouchRouter._unhandled_input() 을 직접 호출하므로
## **상위 노드가 이벤트를 먼저 소비하는 경로**를 못 본다. 최상단 띠 제스처가 press 만
## 소비하고 drag 를 흘려 TouchRouter 에 유령 터치를 남기던 결함이 정확히 그 사각지대였다
## (릴레이가 화면에 없는 손가락으로 넘어가 기체가 영구히 멈췄다).
##
## 그래서 이 러너는 실제 씬(main.tscn)을 띄우고 뷰포트로 이벤트를 밀어 넣는다.

const BAND_Y := 30.0        # 최상단 64유닛 안 — 장면 전환 제스처 영역
const PLAY_Y := 1100.0

var _fail := 0
var _main: Node = null

func _check(ok: bool, label: String) -> void:
	print("  %s %s" % ["OK  " if ok else "FAIL", label])
	if not ok:
		_fail += 1

func _ready() -> void:
	print("== 실제 입력 경로 (Viewport.push_input) ==")
	_main = load("res://scenes/main.tscn").instantiate()
	add_child(_main)
	await get_tree().physics_frame
	await get_tree().physics_frame
	await _ghost_touch_case()
	_main.queue_free()
	_main = null
	await get_tree().process_frame
	await _boss_clear_case()
	await _system_cases()
	await _bomb_input_cases()
	print("== 실패 %d ==" % _fail)
	get_tree().quit(1 if _fail > 0 else 0)

func _push(e: InputEvent) -> void:
	get_viewport().push_input(e, true)

func _touch(idx: int, p: Vector2, pressed: bool) -> void:
	var e := InputEventScreenTouch.new()
	e.index = idx; e.position = p; e.pressed = pressed
	_push(e)

func _drag(idx: int, p: Vector2, rel: Vector2) -> void:
	var e := InputEventScreenDrag.new()
	e.index = idx; e.position = p; e.screen_relative = rel
	_push(e)

## 띠를 두드리는 동안(전환 미완료) 플레이 손가락으로 계속 조작할 수 있어야 한다.
## 그리고 그 손가락을 뗐다 다시 잡아도 조작이 돌아와야 한다.
func _ghost_touch_case() -> void:
	TouchRouter.clear_touches()
	TouchRouter.reset_run()
	SimClock.state = SimClock.State.RUN

	_touch(0, Vector2(300.0, PLAY_Y), true)          # 플레이 엄지
	_touch(1, Vector2(360.0, BAND_Y), true)          # 띠 탭 1회 (전환은 3회)
	_drag(1, Vector2(361.0, BAND_Y + 1.0), Vector2(1.0, 1.0))
	_touch(1, Vector2(361.0, BAND_Y + 1.0), false)
	_check(not TouchRouter._touch.has(1) and TouchRouter.drag_idx == 0,
		"띠 탭이 TouchRouter 에 유령을 남기지 않는다 (touch %s · drag %d)" % [
			TouchRouter._touch.keys(), TouchRouter.drag_idx])

	# 플레이 엄지를 떼면 재파지다 — 갈 곳이 없으므로 릴레이가 아니다
	_drag(0, Vector2(360.0, PLAY_Y), Vector2(60.0, 0.0))
	_touch(0, Vector2(360.0, PLAY_Y), false)
	_check(TouchRouter.drag_idx == -1 and TouchRouter.relay_count == 0,
		"유령으로 릴레이되지 않는다 (drag %d · 릴레이 %d)" % [
			TouchRouter.drag_idx, TouchRouter.relay_count])

	# 다시 잡으면 조작이 돌아온다
	_touch(0, Vector2(300.0, PLAY_Y), true)
	var before: float = _main.player.x
	_drag(0, Vector2(400.0, PLAY_Y), Vector2(100.0, 0.0))
	await get_tree().physics_frame
	await get_tree().physics_frame
	_check(TouchRouter.drag_idx == 0 and absf(_main.player.x - before) > 1.0,
		"재파지 후 조작 복귀 (drag %d · x %.1f → %.1f)" % [
			TouchRouter.drag_idx, before, _main.player.x])
	TouchRouter.clear_touches()

## 보스 격파 → 재시작 경로. 무조작 헤드리스 런은 50초 전에 죽으므로 스모크 테스트로는
## 이 경로가 한 번도 실행되지 않는다. 격파 직전에 사망 판정이 돌아 clear·death 가 같은
## 틱에 기록되고 청록 플래시가 얼어붙던 결함이 여기 있었다.
func _boss_clear_case() -> void:
	TouchRouter.clear_touches()
	TouchRouter.reset_run()
	var bm: Node = load("res://scenes/boss_rush.tscn").instantiate()
	add_child(bm)
	await get_tree().physics_frame
	await get_tree().physics_frame
	var run0: int = SimClock.run_index
	var deaths0: int = bm.deaths
	# 탄이 가장 두꺼운 순간(압력 창)에 격파를 만든다 — 격파 틱의 판정이 문제였다
	while bm.boss.window(SimClock.sim_tick).x != 1:
		await get_tree().physics_frame
	for i in 40:
		await get_tree().physics_frame
	# 보스는 3페이즈다 — 한 번의 대미지로는 격파되지 않고 다음 페이즈로 넘어간다.
	# 전이 연출 중에는 무적이므로 gap_left 를 비우고 이어서 넣는다.
	for _p in 3:
		bm.boss.gap_left = 0
		bm.boss.damage(Boss.HP_MAX, SimClock.sim_tick, bm.player)
	await get_tree().physics_frame
	_check(bm.clear_anim >= 0 and bm.deaths == deaths0 and SimClock.state == SimClock.State.RUN,
		"격파 틱에 죽지 않는다 (clear_anim %d · 사망 %d → %d · state %d)" % [
			bm.clear_anim, deaths0, bm.deaths, SimClock.state])
	var restarted := false
	for i in 200:
		await get_tree().physics_frame
		if SimClock.run_index > run0:
			restarted = true
			break
	_check(restarted and bm.clear_anim < 0 and bm.boss.hp_frac() > 0.99,
		"격파 → 2초 뒤 재시작 (재시작 %s · clear_anim %d · HP %.0f%%)" % [
			restarted, bm.clear_anim, bm.boss.hp_frac() * 100.0])
	bm.queue_free()
	await get_tree().process_frame

# ── 3단계 시스템 ────────────────────────────────────────────────────────
## 라이프·구제 창·폭탄·부활은 사망 흐름 전체를 바꾼다. 헤드리스 스모크는 이 경로를
## 한 번도 밟지 않으므로(무조작 런은 그냥 죽는다) 여기서 강제로 통과시킨다.
func _mk_stage() -> Node:
	TouchRouter.clear_touches()
	TouchRouter.reset_run()
	var m: Node = load("res://scenes/main.tscn").instantiate()
	add_child(m)
	await get_tree().physics_frame
	await get_tree().physics_frame
	return m

## 기체 위에 탄을 직접 놓아 피격을 만든다 — 웨이브를 기다리지 않는다.
func _force_hit(m: Node) -> void:
	m.invincible_left = 0
	var p: Vector2 = m.player
	BulletField.spawn(p.x, p.y, 0.0, 0.0, Tune.Kind.SPORE_TIDE)
	await get_tree().physics_frame

func _system_cases() -> void:
	# ① 피격은 사망이 아니라 구제 창을 연다
	var m := await _mk_stage()
	var lives0: int = m.lives
	await _force_hit(m)
	_check(SimClock.state == SimClock.State.RESCUE and m.lives == lives0 and m.deaths == 0,
		"피격 → 구제 창 (state %d · 라이프 %d · 사망 %d)" % [SimClock.state, m.lives, m.deaths])

	# ② 창 안에 폭탄 → 사망 취소. 기둥 밖 탄은 남는다(전탄 소거가 아니다).
	var far_x: float = m.player.x + Tune.BOMB_COL_HALF + 60.0
	BulletField.spawn(far_x, m.player.y - 200.0, 0.0, 0.0, Tune.Kind.SPORE_TIDE)
	var bombs0: int = m.bombs
	TouchRouter.bomb_pressed = true
	await get_tree().physics_frame
	_check(SimClock.state == SimClock.State.RUN and m.lives == lives0 and m.bombs == bombs0 - 1,
		"구제 성공 (state %d · 라이프 %d · 폭탄 %d→%d)" % [
			SimClock.state, m.lives, bombs0, m.bombs])
	var outside := false
	for i in BulletField.n:
		if absf(BulletField.pos_x[i] - m.bomb_pos.x) > Tune.BOMB_COL_HALF:
			outside = true
	_check(outside, "폭탄이 기둥 밖을 남긴다 (탄 %d)" % BulletField.n)
	m.queue_free(); await get_tree().process_frame

	# ③ 창 만료 → 사망. 라이프가 남으면 탭에 사망 지점 부활, 런은 이어진다.
	m = await _mk_stage()
	m.bombs = 0
	lives0 = m.lives
	await _force_hit(m)
	for i in Tune.RESCUE_TICKS + Tune.RESCUE_HITSTOP + 8:
		await get_tree().physics_frame
	_check(m.lives == lives0 - 1 and m.deaths == 1
			and (SimClock.state == SimClock.State.DEATH_REPLAY
				or SimClock.state == SimClock.State.DEATH_FROZEN),
		"창 만료 → 사망 (라이프 %d→%d · state %d)" % [lives0, m.lives, SimClock.state])
	var run0: int = SimClock.run_index
	var tick0: int = SimClock.sim_tick
	var dpos: Vector2 = m.lesson_death_pos
	m._restart_armed = true
	await get_tree().physics_frame
	await get_tree().physics_frame
	_check(SimClock.state == SimClock.State.RUN and SimClock.run_index == run0
			and SimClock.sim_tick >= tick0 and m.player.distance_to(dpos) < 40.0
			and m.invincible_left > 0,
		"라이프 남음 → 사망 지점 부활·런 유지 (run %d · tick %d→%d · 무적 %d)" % [
			SimClock.run_index, tick0, SimClock.sim_tick, m.invincible_left])

	# ④ 라이프 0 → 완전 재시작
	m.lives = 1
	m.bombs = 0
	await _force_hit(m)
	for i in Tune.RESCUE_TICKS + Tune.RESCUE_HITSTOP + 8:
		await get_tree().physics_frame
	_check(m.lives == 0, "마지막 라이프 소모 (라이프 %d)" % m.lives)
	run0 = SimClock.run_index
	m._restart_armed = true
	await get_tree().physics_frame
	await get_tree().physics_frame
	_check(SimClock.run_index > run0 and m.lives == Tune.LIVES and m.bombs == Tune.BOMBS
			and m.score == 0,
		"라이프 0 → 완전 재시작 (run %d → %d · 라이프 %d · 폭탄 %d)" % [
			run0, SimClock.run_index, m.lives, m.bombs])

	# ⑤ 광립 회수 → 점수. graze 링 반경으로 먹는다.
	var sc0: int = m.score
	m.motes.spawn(SimClock.sim_tick - Tune.MOTE_HOME_DELAY,
			m.player.x + Tune.GRAZE_R * 0.5, m.player.y)
	await get_tree().physics_frame
	_check(m.score > sc0 and m.motes.n == 0,
		"광립 회수 → 점수 (%d → %d · 남은 광립 %d)" % [sc0, m.score, m.motes.n])
	m.queue_free()
	await get_tree().process_frame

## 폭탄 입력을 **실제 입력 경로로** 확인한다.
## _system_cases 는 TouchRouter.bomb_pressed 를 직접 세워 우회하므로,
## "덱을 눌렀는데 폭탄이 안 나간다" 를 잡지 못한다 — 실기에서 구제 성공률 0% 였던 결함이
## 정확히 그 사각지대였다(손가락이 없을 때 press 가 드래그 배정으로 흘렀다).
func _bomb_input_cases() -> void:
	var deck_y := 1560.0 - Tune.DECK_H * 0.5     # 덱 한가운데
	for case in [["드래그 손가락 있음", 1], ["드래그 손가락 없음", 0], ["팜 포함 3접촉", 2]]:
		var m := await _mk_stage()
		var bombs0: int = m.bombs
		if int(case[1]) >= 1:
			_touch(0, Vector2(300.0, 1100.0), true)
			await get_tree().physics_frame
		if int(case[1]) == 2:
			_touch(1, Vector2(150.0, 1500.0), true)    # 덱에 얹힌 팜
			await get_tree().physics_frame
		await _force_hit(m)
		if SimClock.state != SimClock.State.RESCUE:
			_check(false, "폭탄 입력 — %s : 구제 창이 안 열렸다" % case[0])
			m.queue_free(); await get_tree().process_frame
			continue
		# 창 동안 쌓인 드래그 델타가 부활 첫 틱에 터지지 않아야 한다
		var p0: Vector2 = m.player
		if int(case[1]) >= 1:
			for i in 12:
				_drag(0, Vector2(300.0, 1100.0 + float(i) * 19.0), Vector2(0.0, 19.0))
		var tick0: int = SimClock.sim_tick
		_touch(7, Vector2(420.0, deck_y), true)
		await get_tree().physics_frame
		_check(m.bombs == bombs0 - 1 and SimClock.state == SimClock.State.RUN
				and m.lives == Tune.LIVES,
			"폭탄 입력 — %s (폭탄 %d→%d · state %d · 라이프 %d)" % [
				case[0], bombs0, m.bombs, SimClock.state, m.lives])
		# 구제 성공 프레임은 이미 실행이 끝난 틱이다 — 다시 돌리면 안 된다
		_check(SimClock.sim_tick == tick0,
			"구제 프레임에 틱 재실행 없음 — %s (tick %d → %d)" % [
				case[0], tick0, SimClock.sim_tick])
		await get_tree().physics_frame
		await get_tree().physics_frame
		_check(m.player.distance_to(p0) <= Tune.MAX_STEP_PER_TICK * 2.0,
			"구제 직후 기체 점프 없음 — %s (%.0f유닛)" % [case[0], m.player.distance_to(p0)])
		if int(case[1]) >= 1:
			_check(TouchRouter.drag_idx >= 0,
				"구제 직후 조작 유지 — %s (drag %d)" % [case[0], TouchRouter.drag_idx])
		m.queue_free()
		await get_tree().process_frame
	TouchRouter.clear_touches()
