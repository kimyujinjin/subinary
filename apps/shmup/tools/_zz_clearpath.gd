extends Node
## 반증 프로브 — stage_full 에서 보스를 실제로 격파하면 무슨 화면이 뜨는가.
## flow_runner 는 finish_run(true) 를 직접 부르므로 이 경로를 한 번도 밟지 않는다.

func _p(s: String) -> void:
	print(s)

func _ready() -> void:
	SaveData.reset_for_test("user://save-zzclearpath.json")
	await get_tree().process_frame
	var m: Main = load("res://src/main.gd").new()
	m.stage_full = true
	add_child(m)
	await get_tree().process_frame
	var sh: Shell = m._shell
	sh.screen = Shell.Screen.TITLE
	_p("A0 screen=%d cleared_mask=%d hard=%s" % [sh.screen, SaveData.cleared_mask,
			SaveData.unlocked(Difficulty.Level.HARD)])

	# 사람이 앱을 켜서 Normal 을 고르는 경로
	sh._activate(0)                                   # TITLE → DIFF
	sh._activate(Difficulty.Level.NORMAL)             # → PLAY (begin_run)
	_p("A1 screen=%d playing=%s tick=%d" % [sh.screen, sh.playing(), SimClock.sim_tick])

	# 구역 6(index 5)의 시작틱 = Stage.BOSS_AT. 연습 진입으로 보스 자리에서 런을 연다.
	sh._go(Shell.Screen.PRACTICE)
	sh._activate(5)
	await get_tree().physics_frame
	await get_tree().physics_frame
	_p("A2 tick=%d zone=%d boss=%s" % [SimClock.sim_tick,
			Stage.zone_of(SimClock.sim_tick) + 1, m.boss != null])

	# 보스가 붙을 때까지
	var guard := 0
	while m.boss == null and guard < 600:
		await get_tree().physics_frame
		guard += 1
	_p("A3 boss=%s hp=%.0f%% phase=%d tick=%d" % [m.boss != null,
			(m.boss.hp_frac() * 100.0) if m.boss != null else -1.0,
			m.boss.phase if m.boss != null else -1, SimClock.sim_tick])
	if m.boss == null:
		_p("보스 미생성 — 프로브 실패")
		get_tree().quit(2)
		return

	m._cap_invincible = true        # 격파 전 몇 틱 사이에 죽지 않게
	m.score = 9999
	var run0 := SimClock.run_index
	# 3페이즈 격파 (input_path_runner 와 같은 방식)
	for _i in 3:
		m.boss.gap_left = 0
		m.boss.damage(Boss.HP_MAX, SimClock.sim_tick, m.player)
	await get_tree().physics_frame
	_p("A4 done=%s reason=%s clear_anim=%d state=%d" % [m.boss.done,
			m.boss.done_reason, m.clear_anim, SimClock.state])

	for _i in 200:
		await get_tree().physics_frame
		if sh.screen == Shell.Screen.RESULT:
			break
	_p("A5 screen=%d RESULT=%d result_cleared=%s result_score=%d run %d→%d" % [
			sh.screen, Shell.Screen.RESULT, sh.result_cleared, sh.result_score,
			run0, SimClock.run_index])
	_p("A6 cleared_mask=%d hard_unlocked=%s best_normal=%d" % [SaveData.cleared_mask,
			SaveData.unlocked(Difficulty.Level.HARD), SaveData.best[Difficulty.Level.NORMAL]])
	_p("A7 화면문구=%s 종료음=%s" % ["CLEAR" if sh.result_cleared else "RUN OVER",
			"Sfx.CLEAR" if sh.result_cleared else "Sfx.HIT"])
	m.queue_free()
	await get_tree().process_frame
	Audio.teardown()
	await get_tree().process_frame
	get_tree().quit(0)
