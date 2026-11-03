extends Node
## 화면 흐름 관통 — 타이틀에서 결과까지 실제 입력 경로로 간다.
## 셸은 헤드리스에서 PLAY 로 시작하므로(러너 보호), 여기서는 명시적으로 TITLE 로 돌려
## "사람이 앱을 켰을 때" 와 같은 경로를 만든다.
var _fail := 0

func _check(ok: bool, label: String) -> void:
	print("  %s %s" % ["OK  " if ok else "FAIL", label])
	if not ok:
		_fail += 1

func _ready() -> void:
	# 실제 세이브를 건드리지 않는다. 안 그러면 이 테스트가 남긴 해금 상태 때문에
	# 다음 실행의 결과가 달라진다(실측: "Normal 로 시작" 이 Hard 로 시작돼 실패했다).
	SaveData.reset_for_test("user://save-flowtest.json")
	await get_tree().process_frame
	# **씬을 인스턴스화한다.** 스크립트를 직접 new() 하면 입력이 닿지 않아
	# push_input 으로 하는 검사가 전부 조용히 통과한다(실측: drag_idx 가 -1 로 남았다).
	var m: Main = load("res://scenes/stage_full.tscn").instantiate()
	add_child(m)
	await get_tree().process_frame
	var sh: Shell = m._shell
	sh.screen = Shell.Screen.TITLE
	_check(sh != null and not sh.playing(), "앱을 켜면 타이틀이다")

	var t0 := SimClock.sim_tick
	for i in 5:
		await get_tree().physics_frame
	_check(SimClock.sim_tick == t0, "타이틀에서 시뮬 정지 (tick %d)" % SimClock.sim_tick)

	sh._activate(0)                                  # PLAY → 조종사
	_check(sh.screen == Shell.Screen.PILOT, "PLAY → 조종사 선택 (screen %d)" % sh.screen)
	sh._activate(Cast.Pilot.HAEMU)                   # 조종사 고르면 난이도로
	_check(sh.screen == Shell.Screen.DIFF and Cast.pilot == Cast.Pilot.HAEMU,
		"조종사 선택 → 난이도 (%s)" % Cast.pilot_name())
	_check(absf(Cast.shot_dmg(false) - Tune.SHOT_DMG * Cast.DMG_MULT[Cast.Pilot.HAEMU]) < 0.001,
		"조종사가 자탄 대미지를 바꾼다 (%.2f)" % Cast.shot_dmg(false))
	_check(SaveData.unlocked(Difficulty.Level.NORMAL)
			and not SaveData.unlocked(Difficulty.Level.HARD) or SaveData.cleared_mask != 0,
		"Hard 는 Normal 클리어 전까지 잠겨 있다 (cleared %d)" % SaveData.cleared_mask)

	sh._activate(Difficulty.Level.HARD)              # 잠긴 것은 안 열린다
	_check(sh.screen == Shell.Screen.DIFF or SaveData.cleared_mask != 0,
		"잠긴 난이도는 눌러도 안 시작된다")

	sh._activate(Difficulty.Level.NORMAL)
	_check(sh.playing() and Difficulty.level == Difficulty.Level.NORMAL,
		"Normal 시작 (screen %d · diff %s)" % [sh.screen, Difficulty.name_of()])
	# 첫 적은 t=30 에 나오지만 화면 밖(-50)에서 하강해 정지한 뒤에 쏜다 — 120틱은
	# 아직 하강 중이다. 관측 기록을 보려면 실제로 발사할 때까지 돌려야 한다.
	for i in 320:
		await get_tree().physics_frame
	_check(SimClock.sim_tick >= 300, "플레이 중 시뮬이 돈다 (tick %d)" % SimClock.sim_tick)
	_check(SaveData.seen_count() > 0, "패턴이 관측 기록에 점등된다 (%d/16)" % SaveData.seen_count())

	var tick_at_pause := SimClock.sim_tick
	sh._go(Shell.Screen.PAUSE)
	for i in 10:
		await get_tree().physics_frame
	_check(SimClock.sim_tick == tick_at_pause,
		"일시정지에서 시뮬 정지 (%d → %d)" % [tick_at_pause, SimClock.sim_tick])
	sh._activate(0)                                  # RESUME
	for i in 5:
		await get_tree().physics_frame
	_check(sh.playing() and SimClock.sim_tick > tick_at_pause, "RESUME → 이어서 돈다")

	m.score = 7777
	m.finish_run(true)
	_check(sh.screen == Shell.Screen.RESULT and sh.result_cleared
			and SaveData.cleared_mask != 0 and SaveData.unlocked(Difficulty.Level.HARD),
		"클리어 → 결과 화면 · Hard 해금 (cleared %d)" % SaveData.cleared_mask)
	_check(SaveData.best[Difficulty.Level.NORMAL] >= 7777,
		"최고 점수 기록 (%d)" % SaveData.best[Difficulty.Level.NORMAL])

	sh._activate(1)                                  # TITLE
	_check(sh.screen == Shell.Screen.TITLE, "결과 → 타이틀")
	sh._activate(0)                                  # → 조종사
	sh._activate(Cast.Pilot.NARIN)                   # → 난이도
	sh._activate(Difficulty.Level.HARD)
	_check(sh.playing() and Difficulty.level == Difficulty.Level.HARD,
		"해금된 Hard 로 시작된다 (%s)" % Difficulty.name_of())

	# 연습 — 구역 5 로 진입하면 그 구역의 첫 틱에서 열린다
	sh._go(Shell.Screen.PRACTICE)
	sh._activate(4)
	await get_tree().physics_frame
	_check(sh.playing() and SimClock.sim_tick >= Stage.zone_of_start(4),
		"연습 구역 5 진입 (tick %d ≥ %d)" % [SimClock.sim_tick, Stage.zone_of_start(4)])
	_check(Stage.zone_of(SimClock.sim_tick) == 4,
		"그 틱이 실제로 구역 5 다 (zone %d)" % (Stage.zone_of(SimClock.sim_tick) + 1))

	# ── 반증 패스가 잡은 결함들의 재발 방지 ──────────────────────────────
	# ① 셸이 남의 손가락 release 를 삼켜 유령이 남는가.
	#    플레이 중 TouchRouter 가 press 를 가져간 손가락이 있는 상태에서 셸을 띄우고,
	#    그 손가락을 메뉴 위에서 뗀 뒤 새 런에서 기체가 움직이는지 본다.
	sh._go(Shell.Screen.PLAY)
	m.begin_run()
	await get_tree().physics_frame
	var vp := get_viewport()
	var ev0 := InputEventScreenTouch.new()
	ev0.index = 0
	ev0.pressed = true
	ev0.position = Vector2(300.0, 900.0)
	# 두 번째 인자(in_local_coords)가 없으면 좌표가 화면 좌표로 변환돼 엉뚱한 곳에 닿는다 —
	# 검사가 조용히 통과한다(실측: drag_idx 가 -1 로 남아 "유령 없음" 이 거짓 통과했다).
	vp.push_input(ev0, true)
	await get_tree().physics_frame
	_check(TouchRouter.drag_idx == 0, "손가락 0 이 드래그 역할을 잡았다 (drag %d)" % TouchRouter.drag_idx)
	m.finish_run(false)                       # 입력 없이 결과 화면이 뜨는 경로
	var ev0u := InputEventScreenTouch.new()
	ev0u.index = 0
	ev0u.pressed = false
	ev0u.position = Vector2(300.0, 900.0)
	vp.push_input(ev0u, true)                        # 메뉴 위에서 뗀다 — 셸이 먹는다
	await get_tree().physics_frame
	_check(TouchRouter.drag_idx == -1,
		"셸 진입 시 소유자가 손가락을 놓는다 — 유령 없음 (drag %d)" % TouchRouter.drag_idx)

	sh._activate(0)                            # AGAIN
	await get_tree().physics_frame
	var px0: float = m.player.x
	var t1 := InputEventScreenTouch.new()
	t1.index = 0
	t1.pressed = true
	t1.position = Vector2(300.0, 900.0)
	vp.push_input(t1, true)
	await get_tree().physics_frame
	var d1 := InputEventScreenDrag.new()
	d1.index = 0
	d1.position = Vector2(420.0, 900.0)
	# **screen_relative** 를 쓴다. TouchRouter 가 relative 를 무시하는 이유는
	# Camera2D·stretch 가 그 값을 오염시키기 때문이다(touch_router.gd:4).
	d1.screen_relative = Vector2(120.0, 0.0)
	vp.push_input(d1, true)
	for i in 20:
		await get_tree().physics_frame
	_check(absf(m.player.x - px0) > 20.0,
		"다음 런에서 기체가 움직인다 (x %.1f → %.1f)" % [px0, m.player.x])

	# ② 보스 격파가 CLEAR 로 기록되는가 — 러너가 finish_run(true) 를 직접 부르지 않고
	#    **게임 경로**(_step_boss_clear → _clear_left 소진)를 그대로 탄다.
	SaveData.cleared_mask = 0
	sh._go(Shell.Screen.PLAY)
	m.begin_run()
	await get_tree().physics_frame
	m.boss = Boss.new()
	m.boss.reset(SimClock.sim_tick)
	m.boss.done = true
	m.boss.done_reason = "hp"
	m.score = 5555
	for i in Main.CLEAR_TICKS + 6:
		await get_tree().physics_frame
	_check(sh.screen == Shell.Screen.RESULT and sh.result_cleared
			and SaveData.cleared_mask != 0,
		"게임 경로로 보스 격파 → CLEAR (screen %d · cleared %s · mask %d)" % [
			sh.screen, str(sh.result_cleared), SaveData.cleared_mask])

	# ③ 일시정지 진입 경로가 **입력으로** 열리는가.
	sh._activate(0)
	await get_tree().physics_frame
	var pt := InputEventScreenTouch.new()
	pt.index = 3
	pt.pressed = true
	pt.position = Vector2(m.view_w - 40.0, 30.0)
	vp.push_input(pt, true)
	await get_tree().physics_frame
	_check(sh.screen == Shell.Screen.PAUSE,
		"띠 오른쪽 탭 → 일시정지 (screen %d)" % sh.screen)

	# ④ 두 번째 손가락이 첫 버튼 탭을 취소하지 않는가.
	sh._go(Shell.Screen.TITLE)
	sh.layout()
	var a1 := InputEventScreenTouch.new()
	a1.index = 0
	a1.pressed = true
	a1.position = sh._btns[0][0].get_center()
	sh.handle(a1)
	var b1 := InputEventScreenTouch.new()      # 팜 접촉 — 버튼 밖
	b1.index = 1
	b1.pressed = true
	b1.position = Vector2(10.0, 10.0)
	sh.handle(b1)
	var b2 := InputEventScreenTouch.new()
	b2.index = 1
	b2.pressed = false
	b2.position = Vector2(10.0, 10.0)
	sh.handle(b2)
	var a2 := InputEventScreenTouch.new()
	a2.index = 0
	a2.pressed = false
	a2.position = a1.position
	sh.handle(a2)
	# 타이틀의 첫 버튼은 PLAY 이고 그 목적지는 이제 조종사 선택이다.
	_check(sh.screen == Shell.Screen.PILOT,
		"두 번째 손가락이 첫 탭을 취소하지 않는다 (screen %d)" % sh.screen)

	# ⑤ 보스 등장 대사 — 시뮬이 멈추고, 탭으로 넘기면 **그 틱 그대로** 이어진다.
	sh.practice_zone = -1
	sh._go(Shell.Screen.PLAY)
	m.begin_run()
	await get_tree().physics_frame
	m._talk(Cast.MID_TALK, 2)
	_check(sh.screen == Shell.Screen.TALK and sh.talk_line == 0,
		"보스 등장 → 대사 화면 (screen %d)" % sh.screen)
	var t_talk := SimClock.sim_tick
	for i in 8:
		await get_tree().physics_frame
	_check(SimClock.sim_tick == t_talk, "대사 중 시뮬 정지 (%d → %d)" % [t_talk, SimClock.sim_tick])
	for i in Cast.MID_TALK.size():
		sh._activate(0)
	_check(sh.playing() and SimClock.sim_tick == t_talk,
		"대사가 끝나면 그 틱 그대로 이어진다 (screen %d · tick %d)" % [sh.screen, SimClock.sim_tick])

	# ⑥ 연습 모드에서는 대사를 띄우지 않는다 — 같은 구역을 반복하는데 매번 보면 방해다.
	sh.practice_zone = 2
	m._talk(Cast.MID_TALK, 2)
	_check(sh.playing(), "연습 모드에서는 대사를 건너뛴다 (screen %d)" % sh.screen)
	sh.practice_zone = -1

	m.queue_free()
	await get_tree().process_frame
	Audio.teardown()
	await get_tree().process_frame
	print("== 실패 %d ==" % _fail)
	get_tree().quit(1 if _fail > 0 else 0)
