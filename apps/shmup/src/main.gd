extends Node2D
## 게이트 1 슬라이스. 답할 질문은 정확히 하나다 —
## "조류를 읽고 좁은 틈을 지나는 것이 재미있는가."
##
## 틱 순서를 여기서 명시적으로 고정한다. 시그널로 흩뿌리지 않는 이유는
## 결정론에서 순서가 곧 결과이고, 순서가 코드 한 곳에 없으면 디버깅이 불가능해지기 때문이다.

## 보스 러시(boss_rush.tscn)는 이 스크립트를 boss_mode = true 로 쓴다. 틱 순서·판정·
## 사망 교재·계측을 전부 공유하고, 웨이브 대신 보스가 탄을 낸다 — 두 벌로 가르면
## 한쪽에서 고친 결함이 다른 쪽에 남는다(이 슬라이스에서 이미 여러 번 겪었다).
@export var boss_mode: bool = false

const SCENE_STAGE := "res://scenes/main.tscn"
const SCENE_BOSS := "res://scenes/boss_rush.tscn"
const CLEAR_TICKS := 120            # 보스 P1 격파 후 재시작까지 2초
const DEATH_HITSTOP := 8
const LESSON_HOLD_TICKS := 12       # 정지 프레임
const INVINCIBLE_TICKS := 90
const FIXED_SEED := 20260910        # 고정 시드 — P10 계열이 없어도 웨이브 재현에 쓴다

var player: Vector2 = Vector2(Tune.PF_W * 0.5, Tune.PF_H * 0.78)
var player_prev: Vector2 = player
var invincible_left: int = 0
var deaths: int = 0
var lives: int = Tune.LIVES
var bombs: int = Tune.BOMBS
var score: int = 0
var bomb_pos: Vector2 = Vector2.ZERO     # 폭탄 연출 중심 (ScreenOverlay·FieldOverlay 가 읽는다)
var motes: MoteField = null
var _graze_seen: int = 0
var _pending_death: bool = false          # 구제 창이 열려 있다 = 아직 확정되지 않은 사망

# 자탄 — 조류 영향 없음, 관통. SoA.
var shot_x := PackedFloat32Array()
var shot_y := PackedFloat32Array()
var shot_n: int = 0

var enemies: EnemyField = null
var boss: Boss = null
var clear_anim: int = -1            # 보스 P1 격파 연출 시계 (ScreenOverlay 가 읽는다)
var _clear_left: int = -1
var _boss_view: BossView = null
var _toggle_taps: int = 0
var _toggle_tick: int = -9999
## 최상단 띠가 press 를 가져간 터치 index. 그 index 의 drag·release 만 함께 소비한다 —
## press 만 소비하면 그 손가락의 drag 가 TouchRouter 로 새어 _touch 에 유령 항목이 남고,
## 다음 재파지에서 릴레이가 화면에 없는 손가락으로 넘어가 기체가 영구히 멈춘다(실측).
var _band_idx: Dictionary = {}
var fairness: Fairness = null
var replay: Replay = null

var lesson_step: int = 0
var lesson_hold: int = 0
var lesson_bid: int = 0
var lesson_death_pos: Vector2 = Vector2.ZERO
var _restart_armed: bool = false
var _death_wall_tick: int = -1

## 플레이필드의 가로 오프셋. expand 는 여유 축을 늘리므로 태블릿에서는 가시영역 폭이
## 889 유닛이 되고(실측) 플레이필드 720 이 좌측에 붙어 우측 169유닛이 죽는다.
## 중앙에 놓으면 남는 좌우가 대칭 거터가 되고 엄지 도달 거리도 좌우 대칭이 된다.
var field_dx: float = 0.0
var view_w: float = Tune.PF_W

var _field: Node2D = null           # 스케일되는 월드 공간
var _screen: Node2D = null          # 뷰포트 공간 UI
var _backdrop: Backdrop = null
var _bullets: BulletRenderer = null
var _overlay: FieldOverlay = null
var _screen_ui: ScreenOverlay = null
var _wave_cursor: int = 0
var _rng_enemy := RandomNumberGenerator.new()
var _cap_tick: int = 0
var _cap_path: String = ""
var _cap_invincible: bool = false
var _cap_wall: bool = false
var _cap_rescue: bool = false
var _force_phase: int = 0

func _ready() -> void:
	shot_x.resize(Tune.MAX_PSHOTS)
	shot_y.resize(Tune.MAX_PSHOTS)
	enemies = EnemyField.new()
	motes = MoteField.new()
	fairness = Fairness.new()
	replay = Replay.new()

	_field = Node2D.new()
	_screen = Node2D.new()
	add_child(_field)
	add_child(_screen)
	_backdrop = Backdrop.new()
	_bullets = BulletRenderer.new()
	_bullets.main = self
	_overlay = FieldOverlay.new()
	_overlay.main = self
	_field.add_child(_backdrop)
	if boss_mode:
		boss = Boss.new()
		_boss_view = BossView.new()
		_boss_view.boss = boss
		_field.add_child(_boss_view)      # 탄 레이어 아래 — 탄이 몸통 위를 지나간다
	_field.add_child(_bullets)
	_field.add_child(_overlay)
	_screen_ui = ScreenOverlay.new()
	_screen_ui.main = self
	_screen.add_child(_screen_ui)

	get_viewport().size_changed.connect(_on_resize)
	_on_resize()
	_parse_capture()
	_reset(FIXED_SEED)
	RunLog.write("run", [SimClock.run_index, 0, SimClock.run_seed, 0, 0, "", 0, 0, 0,
			0.0, false, 0, 0, 0.0, 0.0, 0, 0, _build_tag(),
			TouchRouter.field_per_px, TouchRouter.screen_width_mm(),
			"mode=%s" % ("boss" if boss_mode else "stage")])

## --capture=<tick>:<경로> — 지정 틱의 프레임을 PNG 로 저장하고 종료한다.
## 게이트 1 지표 ④(조류 표시 대 배경의 Weber 콘트라스트 ≥ 0.25)는 스크린샷 픽셀값으로
## 재야 하고, 야외 직사광 판정도 같은 경로를 쓴다. 헤드리스에는 렌더링 장치가 없으므로
## 창을 띄운 실행에서만 동작한다.
func _parse_capture() -> void:
	# 두 배열을 모두 본다. 데스크톱에서 "-- --flag" 로 준 것은 get_cmdline_user_args() 에
	# 들어오지만, Android export 의 command_line/extra_args 는 get_cmdline_args() 로 온다 —
	# 실기에서 --screen-mm 이 조용히 무시되는 것으로 확인했다.
	var args: PackedStringArray = OS.get_cmdline_user_args()
	args.append_array(OS.get_cmdline_args())
	for a in args:
		if a.begins_with("--screen-mm="):
			# 실측 물리 폭 주입. 엔진의 screen_get_dpi() 는 Android 에서 논리 density 다.
			TouchRouter.screen_mm_override = maxf(0.0, a.substr(12).to_float())
		if a.begins_with("--boss-phase="):
			# 보스 페이즈를 강제한다(캡처·검증용). HP 도 그 구간으로 맞춘다.
			_force_phase = clampi(int(a.substr(13)), 1, 3)
		if a == "--cap-rescue":
			# 구제 창을 캡처하려면 실제로 맞아야 한다. 무적을 끄고 첫 피격을 기다린다.
			_cap_rescue = true
		if a.begins_with("--capture="):
			var v := a.substr(10).split(":")
			if v.size() == 2:
				var spec: String = v[0]
				if spec.begins_with("w"):
					# w 접두: 벽시계 틱 기준. 사망 교재를 캡처하려면 시뮬이 멈춘 뒤에도
					# 진행하는 시계가 필요하고, 무적을 켜면 애초에 죽지 않는다.
					_cap_wall = true
					_cap_tick = maxi(1, int(spec.substr(1)))
				else:
					_cap_tick = maxi(1, int(spec))
					# 캡처는 입력 없는 실행이므로 그냥 두면 첫 벽에 죽고 sim_tick 이 멈춘다.
					_cap_invincible = true
				_cap_path = v[1]

func _capture() -> void:
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	var err := img.save_png(_cap_path)
	print("capture %s -> %s (err %d, %dx%d)" % [
		_cap_path, "ok" if err == OK else "fail", err, img.get_width(), img.get_height()])
	get_tree().quit(0 if err == OK else 1)

func _build_tag() -> String:
	return "%s-%s" % [Engine.get_version_info()["string"],
			"debug" if OS.is_debug_build() else "release"]

func _on_resize() -> void:
	# stretch = canvas_items + expand 이므로 폭은 항상 720 유닛이고 높이만 변한다.
	# --force-16x9 는 16:9 실기가 없을 때 최악 케이스(덱 여백 0) 레이아웃만 대체 검증한다.
	var vh := get_viewport().get_visible_rect().size.y
	# 두 인자 배열을 모두 본다(Android extra_args 는 get_cmdline_args() 로 온다).
	var forced := "--force-16x9" in OS.get_cmdline_user_args() \
			or "--force-16x9" in OS.get_cmdline_args()
	if forced:
		vh = Tune.PF_H
	view_w = get_viewport().get_visible_rect().size.x
	field_dx = floorf((view_w - Tune.PF_W) * 0.5)
	_field.position = Vector2(field_dx, 0.0)
	_backdrop.vh = vh
	_backdrop.gutter = field_dx
	_backdrop.gutter_r = view_w - Tune.PF_W - field_dx
	_screen_ui.vh = vh
	_screen_ui.view_w = view_w
	# view_size 를 직접 대입하면 _refresh_metrics 가 덮는다 — 높이 오버라이드로 전달한다.
	TouchRouter.view_h_override = vh if forced else 0.0
	TouchRouter._refresh_metrics()

func _reset(seed_value: int) -> void:
	SimClock.reset(seed_value)
	BulletField.clear()
	enemies.clear()
	motes.clear()
	replay.clear()
	lives = Tune.LIVES
	bombs = Tune.BOMBS
	score = 0
	_graze_seen = 0
	_pending_death = false
	# 터치 맵은 지우지 않는다(reset_run 주석). clear_touches() 를 부르면 화면에 올려 둔
	# 손가락이 역할을 잃고, 역할 재획득 경로가 press 뿐이라 떼었다 다시 눌러야 움직였다.
	TouchRouter.reset_run()
	_rng_enemy.seed = seed_value
	shot_n = 0
	_wave_cursor = 0
	invincible_left = INVINCIBLE_TICKS
	player = Vector2(Tune.PF_W * 0.5, Tune.PF_H * 0.78)
	player_prev = player
	lesson_step = 0
	lesson_hold = 0
	_restart_armed = false
	_clear_left = -1
	clear_anim = -1
	if boss != null:
		boss.reset(SimClock.sim_tick)
		if _force_phase > 1:
			boss.phase = _force_phase
			boss.phase_t0 = SimClock.sim_tick
			boss.hp = Boss.HP_MAX * (Boss.P1_END_FRAC if _force_phase == 2 else Boss.P2_END_FRAC)
	else:
		BulletField.reset_flow()

# ── 입력: 사망 후 탭 재시작 ─────────────────────────────────────────────
## 디버그 장면 전환 — 로드맵 2단계 "스테이지를 건너뛰는 디버그 키".
## 텍스트 0줄이라 버튼을 둘 수 없다. 플레이 중 손가락이 가지 않는 최상단 HUD 띠(64유닛)를
## 0.5초 안에 세 번 두드리면 스테이지 ↔ 보스 러시를 오간다. 데스크톱은 B 키.
## 그 띠의 press 는 소비한다 — 드래그 역할이나 재시작으로 새지 않게.
func _debug_toggle(event: InputEvent) -> bool:
	if event is InputEventKey:
		var k := event as InputEventKey
		if k.pressed and not k.echo and k.keycode == KEY_B:
			_switch_scene()
			return true
		return false
	if event is InputEventScreenDrag:
		# 띠에서 시작한 손가락의 drag 만 소비한다.
		return _band_idx.has((event as InputEventScreenDrag).index)
	if event is InputEventScreenTouch:
		var t := event as InputEventScreenTouch
		if not t.pressed:
			# release 는 좌표로 판단하지 않는다 — iOS 는 (-1,-1) 로 보내고, 띠에서 시작한
			# 손가락이 아래로 끌려가 떼어질 수도 있다. press 를 가져간 index 만 소비한다.
			return _band_idx.erase(t.index)
		if t.position.y >= 64.0:
			return false
		_band_idx[t.index] = true
		if SimClock.wall_tick - _toggle_tick > 30:
			_toggle_taps = 0
		_toggle_taps += 1
		_toggle_tick = SimClock.wall_tick
		if _toggle_taps >= 3:
			_toggle_taps = 0
			_switch_scene()
		return true
	return false

func _switch_scene() -> void:
	RunLog.flush()
	get_tree().change_scene_to_file.call_deferred(SCENE_STAGE if boss_mode else SCENE_BOSS)

func _unhandled_input(event: InputEvent) -> void:
	if _debug_toggle(event):
		get_viewport().set_input_as_handled()
		return
	# 히트스톱(8틱)이 끝난 뒤, 되감기 중에도 받는다.
	#
	# 한때 "정지 프레임부터만 받는다" 로 바꿨는데 근거가 틀렸다 — 사망→입력 0.00초는
	# 로그를 awk 로 읽다 칼럼 하나(gap_x0)를 잘못 본 것이었고 실제 p50 은 2.75초였다.
	# 그리고 그 게이트는 사망 → 입력 가능 시점을 49틱(0.82초)으로 강제해 지표 ③
	# (p90 < 1.0초)에 반응 시간 여유를 0.18초만 남겼다. 드래그 손가락은 이미 눌려 있어
	# press 를 새로 만들지 않으므로, 되감기 중에 받아도 교재가 우발적으로 스킵되지 않는다.
	if SimClock.state != SimClock.State.DEATH_REPLAY \
			and SimClock.state != SimClock.State.DEATH_FROZEN:
		return
	if (event is InputEventScreenTouch and (event as InputEventScreenTouch).pressed) \
			or (event is InputEventMouseButton and (event as InputEventMouseButton).pressed) \
			or (event is InputEventKey and (event as InputEventKey).pressed):
		_restart_armed = true
		# 지표 ③: 사망 → 다음 입력. 벽시계 틱으로 재고, 되감기 중의 탭도 여기서 잡힌다.
		if _death_wall_tick >= 0:
			RunLog.write("restart", [SimClock.run_index, SimClock.sim_tick, SimClock.run_seed,
					0.0, 0.0, "", 0, 0, SimClock.wall_tick - _death_wall_tick,
					TouchRouter.k, TouchRouter.focus, TouchRouter.regrip_count, -1,
					0.0, 0.0, 0, int(Engine.get_frames_per_second()), "", 0.0, 0.0])
			_death_wall_tick = -1
		# set_input_as_handled() 를 하지 않는다. TouchRouter 가 이 press 를 받아 드래그 역할을
		# 배정해야 재시작 직후 그 손가락으로 곧바로 조작이 이어진다.

func _physics_process(_delta: float) -> void:
	SimClock.begin_tick()
	if _cap_wall and _cap_tick > 0 and SimClock.wall_tick >= _cap_tick:
		_cap_tick = 0
		_capture.call_deferred()
		return

	if SimClock.state == SimClock.State.DEATH_REPLAY:
		if _restart_armed:
			if lives > 0:
				_revive()
			else:
				_restart()
		else:
			_step_lesson()
		return
	if SimClock.state == SimClock.State.DEATH_FROZEN:
		if _restart_armed:
			if lives > 0:
				_revive()
			else:
				_restart()
		else:
			_screen_ui.queue_redraw()   # 재시작 어포던스 깜빡임
		return
	if _cap_rescue and SimClock.state == SimClock.State.RESCUE \
			and SimClock.rescue_left <= Tune.RESCUE_TICKS - 6:
		_cap_rescue = false
		_redraw_all(SimClock.sim_tick)
		_capture.call_deferred()
		return
	if SimClock.state == SimClock.State.RESCUE:
		# 창은 전체가 히트스톱이므로 sim_tick 이 전진하지 않는다 — 즉 지금 sim_tick 이
		# 가리키는 틱은 **피격 프레임에서 이미 끝까지 실행된 틱**이다. 구제에 성공했다고
		# 아래 본체로 떨어지면 그 틱을 통째로 한 번 더 돌린다: 보스 P05·P09 가 이중 발사되고
		# _p09_flip 이 되돌아가 이 런의 남은 파문이 영구히 반대 방향이 되며, 스테이지에서는
		# 볼리·자탄·웨이브가 중복되고 전 탄이 한 스텝 더 적분된다.
		# 다음 프레임의 begin_tick 이 RUN 으로 sim_tick 을 +1 하고 정상 실행한다.
		# 폭탄의 소거·무적은 _try_bomb 안에서 이미 적용됐으므로 지연되지 않는다.
		var frozen := SimClock.hitstop_left > 0
		if _try_bomb():
			if frozen:
				_redraw_all(SimClock.sim_tick)
				return
		elif SimClock.rescue_left <= 0:
			_on_death()
			return
		elif SimClock.hitstop_left > 0:
			_screen_ui.queue_redraw()  # 정지 프레임 — 상황을 읽을 시간
			_overlay.queue_redraw()
			return
	elif SimClock.state == SimClock.State.HITSTOP:
		_screen_ui.queue_redraw()      # 플래시·링 파동은 시뮬이 멈춰도 계속 돈다
		return
	elif SimClock.state == SimClock.State.RUN:
		if _try_bomb():
			pass
		else:
			TouchRouter.bomb_pressed = false

	var tick := SimClock.sim_tick

	# 1. 플레이어 — 먼저 움직인다. 스윕 판정이 상대 변위를 쓰기 때문이다.
	player_prev = player
	var step := TouchRouter.consume(tick)
	player += step
	# 매 틱 상태 클램프. 가상 위치를 저장하지 않는다.
	player.x = clampf(player.x, Tune.MARGIN, Tune.PF_W - Tune.MARGIN)
	var y_min: float = Boss.PLAYER_MIN_Y if boss != null else Tune.MARGIN + Backdrop.BAND_H
	player.y = clampf(player.y, y_min, Tune.PF_H - Tune.MARGIN)
	_log_regrips(tick)

	# 2. 자탄 (자동 사격)
	if tick % Tune.SHOT_PERIOD_TICKS == 0:
		_fire()
	_step_shots()

	# 3. 웨이브 → 적 → 이미터 (보스 러시에서는 보스가 대신한다)
	if boss != null:
		boss.step(tick, player)
	else:
		_spawn_waves(tick)
		enemies.step(tick, player)

	# 4. 자탄 대 적
	if boss != null:
		_shots_vs_boss(tick)
	else:
		_shots_vs_enemies()

	# 4a. 격파 보상 — 적이 종류별 광립 수를 값으로 남긴다(인덱스는 이미 재배정됐다)
	for kill in enemies.kills:
		_drop_motes(kill[0].x, kill[0].y, int(kill[1]))
	enemies.kills.clear()

	# 4b. 광립 — 조류를 타고 부상하다 2초 뒤 기체로 온다. 회수 판정은 graze 링.
	motes.step(tick, player)
	if motes.collected > 0:
		score += motes.collected * int(round(float(Tune.SCORE_MOTE) * _risk_mult()))

	# 5. 탄 적분 + 컬링 + 판정 (단일 순회)
	# boss.done 은 이 틱의 step 4(자탄) 또는 boss.step 에서 켜지는데 _clear_left 는 아직 -1 이다.
	# 그 사이에 판정이 돌면 격파 틱에 죽어서 'clear' 와 'death' 가 같은 틱에 기록되고,
	# clear_anim 이 0 에 얼어붙어 청록 플래시가 사망 화면 전체를 덮는다(리뷰 실측).
	if _cap_invincible or _clear_left >= 0 or (boss != null and boss.done):
		invincible_left = 2
	elif invincible_left > 0:
		invincible_left -= 1
	BulletField.step_and_collide(tick, player_prev, player, invincible_left > 0)

	# 5b. 스침 — 탄당 1회. 게이지·배율·폭탄 충전 없이 점수만.
	if BulletField.graze_events > _graze_seen:
		score += (BulletField.graze_events - _graze_seen) * Tune.SCORE_GRAZE
		_graze_seen = BulletField.graze_events

	# 6. 1D 공정성 스캔 — HUD 와 사망 교재가 같은 숫자를 쓴다
	fairness.scan(BulletField, player.x, player.y)

	# 7. 리플레이 기록 — 교재의 "있어야 했던 틈" 은 플레이어의 통로(near)다.
	#    밴드에 탄이 없으면 통로가 정의되지 않으므로 폭 0 으로 기록한다.
	var has_band := fairness.in_band > 0
	replay.record(BulletField, player, tick,
			fairness.near_x0 if has_band else 0, fairness.near_w if has_band else 0)

	# 8. 판정 — 피격은 곧바로 사망이 아니라 구제 창을 연다
	if BulletField.hit_index >= 0 and not _pending_death:
		_on_hit()
	elif tick % 60 == 0:
		RunLog.write("tick", [SimClock.run_index, tick, SimClock.run_seed,
				player.x, player.y, "", 0, fairness.gap_x0, fairness.gap_w,
				TouchRouter.k, TouchRouter.focus, TouchRouter.regrip_count,
				-1 if TouchRouter.last_regrip_tick < 0 else SimClock.wall_tick - TouchRouter.last_regrip_tick,
				BulletField.flow_c(tick), BulletField.flow_u(player.y, tick),
				BulletField.n, int(Engine.get_frames_per_second()), "", 0.0, 0.0])

	if _cap_tick > 0 and tick >= _cap_tick:
		_cap_tick = 0
		_capture.call_deferred()

	if boss != null and _step_boss_clear(tick):
		return
	_redraw_all(tick)

## 보스 P1 격파(70% 또는 50초). L0 에서는 P2 가 아직 없으므로 탄을 걷고 2초 뒤 재시작한다.
## 반환값 true = 이번 틱에 재시작했다(재드로우는 _restart 가 이미 했다).
func _step_boss_clear(tick: int) -> bool:
	if SimClock.state != SimClock.State.RUN:
		return false            # 사망이 먼저 확정된 틱에는 격파 연출을 시작하지 않는다
	if boss.done and _clear_left < 0:
		_clear_left = CLEAR_TICKS
		clear_anim = 0
		BulletField.clear()
		# 격파 시 세 링이 광립으로 흩어져 전부 상승한다 —
		# 5분 내내 아래로만 흐르던 화면의 운동 방향이 마지막에 뒤집힌다(설계서 §6).
		for ring in [Boss.R_OUTER, Boss.R_MID, Boss.R_INNER]:
			_drop_motes_ring(Boss.CX, Boss.CY, ring, 26)
		RunLog.write("clear", [SimClock.run_index, tick, SimClock.run_seed,
				player.x, player.y, "", 0, 0, 0,
				TouchRouter.k, TouchRouter.focus, TouchRouter.regrip_count, 0,
				BulletField.flow_c(tick), 0.0, 0, int(Engine.get_frames_per_second()),
				"", 0.0, 0.0,
				"reason=%s;hp=%.0f;t=%.2f;relay=%d" % [boss.done_reason, boss.hp,
						float(boss.elapsed(tick)) / 60.0, TouchRouter.relay_count]])
	elif _clear_left > 0:
		_clear_left -= 1
		clear_anim += 1
		if _clear_left == 0:
			_restart()
			return true
	return false

func _redraw_all(tick: int) -> void:
	_backdrop.tick = tick
	_backdrop.queue_redraw()
	if _boss_view != null:
		_boss_view.tick = tick
		_boss_view.queue_redraw()
	_bullets.queue_redraw()
	_overlay.queue_redraw()
	_screen_ui.queue_redraw()

## 재파지 원인 행. 기체 위치와 함께 남겨야 "벽에 붙어서 뗐는지" 를 가를 수 있다.
func _log_regrips(tick: int) -> void:
	if TouchRouter.regrip_events.is_empty():
		return
	for e in TouchRouter.regrip_events:
		var detail := "fx=%.0f;fy=%.0f;held=%d;moved=%.0f;rl=%.0f;rr=%.0f;ru=%.0f;rd=%.0f;excl=%d" % [
			e["fx"], e["fy"], e["held"], e["moved"],
			e["reach_l"], e["reach_r"], e["reach_u"], e["reach_d"], 1 if e["excl"] else 0]
		RunLog.write("regrip", [SimClock.run_index, tick, SimClock.run_seed,
				player.x, player.y, "", 0, 0, 0,
				TouchRouter.k, TouchRouter.focus, TouchRouter.regrip_count, 0,
				BulletField.flow_c(tick), BulletField.flow_u(player.y, tick),
				BulletField.n, int(Engine.get_frames_per_second()), "", 0.0, 0.0, detail])
	TouchRouter.regrip_events.clear()

## 위험 배율 — 기체 y 가 높을수록 광립 점수가 오른다(1.0 → 1.6).
## "위험 감수 = 보상" 교환을 회수 동선이 아니라 고도로 산다.
func _risk_mult() -> float:
	var t := clampf((Tune.RISK_Y_LO - player.y) / (Tune.RISK_Y_LO - Tune.RISK_Y_HI), 0.0, 1.0)
	return lerpf(1.0, Tune.RISK_MULT_HI, t)

## 폭탄 입력을 소비한다. 반환값 = 이번 틱에 터졌는가.
func _try_bomb() -> bool:
	if not TouchRouter.bomb_pressed:
		return false
	TouchRouter.bomb_pressed = false
	if bombs <= 0:
		return false
	bombs -= 1
	bomb_pos = player
	SimClock.bomb_anim = 0
	# 소광침 — 위로 뻗는 기둥 + 주변. 기둥 밖은 그대로 남는다.
	BulletField.clear_column(player.x, Tune.BOMB_COL_HALF, player.y)
	BulletField.clear_radius(player.x, player.y, Tune.BOMB_LOCAL_R)
	invincible_left = maxi(invincible_left, Tune.BOMB_INVINCIBLE)
	var rescued := SimClock.state == SimClock.State.RESCUE
	if rescued:
		_pending_death = false
		SimClock.state = SimClock.State.RUN
		SimClock.rescue_left = 0
		SimClock.hitstop_left = 0
		TouchRouter.drop_pending()
	RunLog.write("bomb", [SimClock.run_index, SimClock.sim_tick, SimClock.run_seed,
			player.x, player.y, "", 0, 0, 0,
			TouchRouter.k, TouchRouter.focus, TouchRouter.regrip_count, 0,
			BulletField.flow_c(SimClock.sim_tick), 0.0, BulletField.n,
			int(Engine.get_frames_per_second()), "", 0.0, 0.0,
			"rescue=%d;left=%d;bombs=%d" % [1 if rescued else 0, bombs, bombs]])
	return true

# ── 피격 · 사망 ─────────────────────────────────────────────────────────
## 피격 = 구제 창을 여는 것이지 사망이 아니다. 창 안에 폭탄을 누르면 취소된다.
func _on_hit() -> void:
	_pending_death = true
	lesson_bid = BulletField.hit_bid
	lesson_death_pos = player
	SimClock.rescue(Tune.RESCUE_TICKS)
	TouchRouter.rescue_watch_begin()
	RunLog.write("hit", [SimClock.run_index, SimClock.sim_tick, SimClock.run_seed,
			player.x, player.y, ["spore_tide", "spore_grid", "needle", "bubble"][BulletField.hit_kind],
			lesson_bid, fairness.gap_x0, fairness.gap_w,
			TouchRouter.k, TouchRouter.focus, TouchRouter.regrip_count, 0,
			BulletField.flow_c(SimClock.sim_tick), 0.0, BulletField.n,
			int(Engine.get_frames_per_second()), "", 0.0, 0.0,
			"bombs=%d;lives=%d" % [bombs, lives]])

func _on_death() -> void:
	deaths += 1
	_pending_death = false
	lives -= 1
	lesson_step = -1        # 첫 되감기 틱에 0 이 된다 — 가장 오래된 프레임부터 보여준다
	lesson_hold = 0
	_restart_armed = false
	var since := -1 if TouchRouter.last_regrip_tick < 0 else SimClock.wall_tick - TouchRouter.last_regrip_tick
	RunLog.write("death", [SimClock.run_index, SimClock.sim_tick, SimClock.run_seed,
			player.x, player.y, ["spore_tide", "spore_grid", "needle", "bubble"][BulletField.hit_kind],
			lesson_bid, fairness.gap_x0, fairness.gap_w,
			TouchRouter.k, TouchRouter.focus, TouchRouter.regrip_count, since,
			BulletField.flow_c(SimClock.sim_tick),
			BulletField.flow_u(player.y, SimClock.sim_tick),
			BulletField.n, int(Engine.get_frames_per_second()), "", 0.0, 0.0,
			"relay=%d;lives=%d;bombs=%d;score=%d;rpress=%d;rfirst=%d;rzone=%d" % [
				TouchRouter.relay_count, lives, bombs, score,
				TouchRouter.rescue_presses, TouchRouter.rescue_first_tick,
				1 if TouchRouter.rescue_first_zone else 0]])
	_death_wall_tick = SimClock.wall_tick
	# 히트스톱 — 정지 프레임으로 상황을 읽을 시간. 연출은 _process 에서 계속 돈다.
	SimClock.hitstop(DEATH_HITSTOP)

## 사망 지점 부활 — 강제 하단 복귀는 손가락 앵커와 기체의 오프셋 관계를 리셋해
## 패닉 중 방향 감각을 파괴한다(설계서 §3). 런은 이어진다: sim_tick 도 시드도 그대로.
func _revive() -> void:
	SimClock.state = SimClock.State.RUN
	SimClock.death_anim = -1
	_restart_armed = false
	player = lesson_death_pos
	player_prev = player
	BulletField.clear_radius(player.x, player.y, Tune.REVIVE_CLEAR_R)
	invincible_left = Tune.REVIVE_INVINCIBLE
	replay.clear()
	TouchRouter.reset_run()
	_redraw_all(SimClock.sim_tick)

func _restart() -> void:
	_reset(FIXED_SEED)
	# 재드로우하지 않으면 재시작 직후 1프레임 동안 이전 런의 화면이 남는다.
	_redraw_all(SimClock.sim_tick)

func _step_lesson() -> void:
	if lesson_step < replay.length() - 1:
		lesson_step += 1
	else:
		lesson_hold += 1
		if lesson_hold >= LESSON_HOLD_TICKS:
			SimClock.state = SimClock.State.DEATH_FROZEN
	_bullets.queue_redraw()     # 교재 탄은 BulletRenderer 가 리플레이 프레임으로 그린다
	if _boss_view != null:
		# 링·발광 기관도 같은 프레임 틱으로 되돌린다. 사망 틱에 고정해 두면 교재에서
		# 탄은 0.5초 과거인데 기관은 사망 시점 각도라 "기관 24개 = 탄 24발" 이 어긋나 보인다
		# (실측: T=500 에서 7.0° = 외륜 위 28유닛, 기관 간격 60유닛의 절반).
		_boss_view.tick = replay.frame_tick(clampi(lesson_step, 0, maxi(replay.length() - 1, 0)))
		_boss_view.queue_redraw()
	_overlay.queue_redraw()
	_screen_ui.queue_redraw()

# ── 자탄 ────────────────────────────────────────────────────────────────
func _fire() -> void:
	# 집중이면 2열이 1줄로 수렴한다(설계서 §3). 대미지는 _shot_dmg() 가 1.4배로 올린다.
	var half: float = 2.0 if TouchRouter.focus else Tune.SHOT_COL_HALF
	for s in [-half, half]:
		if shot_n >= Tune.MAX_PSHOTS:
			return
		shot_x[shot_n] = player.x + s
		shot_y[shot_n] = player.y - Tune.SHIP_VIS
		shot_n += 1

func _step_shots() -> void:
	var i := 0
	while i < shot_n:
		shot_y[i] -= Tune.SHOT_SPEED * Tune.DT
		if shot_y[i] < -30.0:
			shot_n -= 1
			shot_x[i] = shot_x[shot_n]
			shot_y[i] = shot_y[shot_n]
			continue
		i += 1

## 집중 사격은 DPS +40%.
func _shot_dmg() -> float:
	return Tune.SHOT_DMG * (Tune.FOCUS_DMG_MULT if TouchRouter.focus else 1.0)

## 링 둘레에 흩뿌린다 — 격파 연출용.
func _drop_motes_ring(cx: float, cy: float, radius: float, count: int) -> void:
	for i in count:
		var a := TAU * float(i) / float(count)
		motes.spawn(SimClock.sim_tick, cx + cos(a) * radius, cy + sin(a) * radius)

func _drop_motes(x: float, y: float, count: int) -> void:
	for i in count:
		var a := TAU * float(i) / float(maxi(count, 1))
		motes.spawn(SimClock.sim_tick, x + cos(a) * 18.0, y + sin(a) * 18.0)

func _shots_vs_enemies() -> void:
	# N:M 이지만 N ≤ 128, M ≤ 32 이고 관통이라 조기 종료도 없다.
	# 공간 분할을 넣지 않는다 — grid 가 줄일 검사가 없고 Dictionary 삽입이 더 비싸다.
	var j := 0
	while j < enemies.n:
		var ex := enemies.px[j]
		var ey := enemies.py[j]
		var r: float = EnemyField.R_HIT[enemies.etype[j]] + Tune.SHOT_R
		var r2 := r * r
		var dmg := 0.0
		for i in shot_n:
			var dx := shot_x[i] - ex
			var dy := shot_y[i] - ey
			if dx * dx + dy * dy <= r2:
				dmg += _shot_dmg()
		if dmg > 0.0 and enemies.damage(j, dmg):
			continue
		j += 1

## 자탄 대 보스 — 관통하지 않는다. 코어를 지나는 동안 매 틱 대미지를 넣으면
## 판정 반경 70 에서 자탄 한 발이 7틱 동안 7 을 넣는다. 한 발 = 1 로 소모한다.
func _shots_vs_boss(tick: int) -> void:
	if boss.done:
		return
	var r := Boss.R_CORE_HIT + Tune.SHOT_R
	var r2 := r * r
	var i := 0
	while i < shot_n:
		var dx := shot_x[i] - Boss.CX
		var dy := shot_y[i] - Boss.CY
		if dx * dx + dy * dy <= r2:
			boss.damage(_shot_dmg(), tick, player)
			shot_n -= 1
			shot_x[i] = shot_x[shot_n]
			shot_y[i] = shot_y[shot_n]
			continue
		i += 1

# ── 웨이브 ──────────────────────────────────────────────────────────────
func _spawn_waves(tick: int) -> void:
	var loop_t := tick % Stage.LOOP_TICKS
	if loop_t == 0:
		_wave_cursor = 0
	while _wave_cursor < Stage.WAVES.size():
		var w: Array = Stage.WAVES[_wave_cursor]
		if int(w[0]) > loop_t:
			break
		var kind := int(w[1])
		var y0: float = -50.0 if kind == 0 else float(w[3])
		enemies.spawn(tick, kind, float(w[2]), y0, float(w[3]), int(w[4]), int(w[5]), float(w[6]))
		_wave_cursor += 1
