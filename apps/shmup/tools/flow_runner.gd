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
	var m: Main = load("res://src/main.gd").new()
	m.stage_full = true
	add_child(m)
	await get_tree().process_frame
	var sh: Shell = m._shell
	sh.screen = Shell.Screen.TITLE
	_check(sh != null and not sh.playing(), "앱을 켜면 타이틀이다")

	var t0 := SimClock.sim_tick
	for i in 5:
		await get_tree().physics_frame
	_check(SimClock.sim_tick == t0, "타이틀에서 시뮬 정지 (tick %d)" % SimClock.sim_tick)

	sh._activate(0)                                  # PLAY → 난이도
	_check(sh.screen == Shell.Screen.DIFF, "PLAY → 난이도 화면")
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
	sh._activate(0)
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

	m.queue_free()
	await get_tree().process_frame
	Audio.teardown()
	await get_tree().process_frame
	print("== 실패 %d ==" % _fail)
	get_tree().quit(1 if _fail > 0 else 0)
