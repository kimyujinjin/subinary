extends Node2D
## 게이트 1 슬라이스. 답할 질문은 정확히 하나다 —
## "조류를 읽고 좁은 틈을 지나는 것이 재미있는가."
##
## 틱 순서를 여기서 명시적으로 고정한다. 시그널로 흩뿌리지 않는 이유는
## 결정론에서 순서가 곧 결과이고, 순서가 코드 한 곳에 없으면 디버깅이 불가능해지기 때문이다.

const DEATH_HITSTOP := 8
const LESSON_HOLD_TICKS := 12       # 정지 프레임
const INVINCIBLE_TICKS := 90
const FIXED_SEED := 20260910        # 고정 시드 — P10 계열이 없어도 웨이브 재현에 쓴다

var player: Vector2 = Vector2(Tune.PF_W * 0.5, Tune.PF_H * 0.78)
var player_prev: Vector2 = player
var invincible_left: int = 0
var deaths: int = 0

# 자탄 — 조류 영향 없음, 관통. SoA.
var shot_x := PackedFloat32Array()
var shot_y := PackedFloat32Array()
var shot_n: int = 0

var enemies: EnemyField = null
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

func _ready() -> void:
	shot_x.resize(Tune.MAX_PSHOTS)
	shot_y.resize(Tune.MAX_PSHOTS)
	enemies = EnemyField.new()
	fairness = Fairness.new()
	replay = Replay.new()

	_field = Node2D.new()
	_screen = Node2D.new()
	add_child(_field)
	add_child(_screen)
	_backdrop = Backdrop.new()
	_bullets = BulletRenderer.new()
	_overlay = FieldOverlay.new()
	_overlay.main = self
	_field.add_child(_backdrop)
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
			TouchRouter.field_per_px, TouchRouter.screen_width_mm()])

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
	if "--force-16x9" in OS.get_cmdline_user_args():
		vh = Tune.PF_H
	view_w = get_viewport().get_visible_rect().size.x
	field_dx = floorf((view_w - Tune.PF_W) * 0.5)
	_field.position = Vector2(field_dx, 0.0)
	_backdrop.vh = vh
	_backdrop.gutter = field_dx
	_screen_ui.vh = vh
	_screen_ui.view_w = view_w
	TouchRouter.view_size = Vector2(view_w, vh)
	TouchRouter._refresh_metrics()

func _reset(seed_value: int) -> void:
	SimClock.reset(seed_value)
	BulletField.clear()
	enemies.clear()
	replay.clear()
	TouchRouter.reset_run()
	TouchRouter.clear_touches()
	_rng_enemy.seed = seed_value
	shot_n = 0
	_wave_cursor = 0
	invincible_left = INVINCIBLE_TICKS
	player = Vector2(Tune.PF_W * 0.5, Tune.PF_H * 0.78)
	player_prev = player
	lesson_step = 0
	lesson_hold = 0
	_restart_armed = false

# ── 입력: 사망 후 탭 재시작 ─────────────────────────────────────────────
func _unhandled_input(event: InputEvent) -> void:
	if SimClock.state != SimClock.State.DEATH_REPLAY \
			and SimClock.state != SimClock.State.DEATH_FROZEN:
		return
	# 되감기 중에도 탭을 즉시 받는다 — UI 를 기다리게 하면 지표 ③ 이 깨진다.
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
		get_viewport().set_input_as_handled()

func _physics_process(_delta: float) -> void:
	SimClock.begin_tick()
	if _cap_wall and _cap_tick > 0 and SimClock.wall_tick >= _cap_tick:
		_cap_tick = 0
		_capture.call_deferred()
		return

	if SimClock.state == SimClock.State.DEATH_REPLAY:
		_step_lesson()
		return
	if SimClock.state == SimClock.State.DEATH_FROZEN:
		if _restart_armed:
			_reset(FIXED_SEED)
		return
	if SimClock.state == SimClock.State.HITSTOP:
		return

	var tick := SimClock.sim_tick

	# 1. 플레이어 — 먼저 움직인다. 스윕 판정이 상대 변위를 쓰기 때문이다.
	player_prev = player
	var step := TouchRouter.consume(tick)
	player += step
	# 매 틱 상태 클램프. 가상 위치를 저장하지 않는다.
	player.x = clampf(player.x, Tune.MARGIN, Tune.PF_W - Tune.MARGIN)
	player.y = clampf(player.y, Tune.MARGIN + Backdrop.BAND_H, Tune.PF_H - Tune.MARGIN)

	# 2. 자탄 (자동 사격)
	if tick % Tune.SHOT_PERIOD_TICKS == 0:
		_fire()
	_step_shots()

	# 3. 웨이브 → 적 → 이미터
	_spawn_waves(tick)
	enemies.step(tick, player)

	# 4. 자탄 대 적
	_shots_vs_enemies()

	# 5. 탄 적분 + 컬링 + 판정 (단일 순회)
	if _cap_invincible:
		invincible_left = 2
	elif invincible_left > 0:
		invincible_left -= 1
	BulletField.step_and_collide(tick, player_prev, player, invincible_left > 0)

	# 6. 1D 공정성 스캔 — HUD 와 사망 교재가 같은 숫자를 쓴다
	fairness.scan(BulletField, player.x, player.y)

	# 7. 리플레이 기록
	replay.record(BulletField, player, fairness.gap_x0, fairness.gap_w)

	# 8. 판정
	if BulletField.hit_index >= 0:
		_on_death()
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

	_backdrop.tick = tick
	_backdrop.queue_redraw()
	_bullets.queue_redraw()
	_overlay.queue_redraw()
	_screen_ui.queue_redraw()

# ── 사망 ────────────────────────────────────────────────────────────────
func _on_death() -> void:
	deaths += 1
	lesson_bid = BulletField.hit_bid
	lesson_death_pos = player
	lesson_step = 0
	lesson_hold = 0
	_restart_armed = false
	var since := -1 if TouchRouter.last_regrip_tick < 0 else SimClock.wall_tick - TouchRouter.last_regrip_tick
	RunLog.write("death", [SimClock.run_index, SimClock.sim_tick, SimClock.run_seed,
			player.x, player.y, ["spore_tide", "spore_grid", "needle"][BulletField.hit_kind],
			lesson_bid, fairness.gap_x0, fairness.gap_w,
			TouchRouter.k, TouchRouter.focus, TouchRouter.regrip_count, since,
			BulletField.flow_c(SimClock.sim_tick),
			BulletField.flow_u(player.y, SimClock.sim_tick),
			BulletField.n, int(Engine.get_frames_per_second()), "", 0.0, 0.0])
	_death_wall_tick = SimClock.wall_tick
	# 히트스톱 — 정지 프레임으로 상황을 읽을 시간. 연출은 _process 에서 계속 돈다.
	SimClock.hitstop(DEATH_HITSTOP)

func _step_lesson() -> void:
	if _restart_armed:
		_reset(FIXED_SEED)
		return
	if lesson_step < replay.length() - 1:
		lesson_step += 1
	else:
		lesson_hold += 1
		if lesson_hold >= LESSON_HOLD_TICKS:
			SimClock.state = SimClock.State.DEATH_FROZEN
	_overlay.queue_redraw()
	_screen_ui.queue_redraw()

# ── 자탄 ────────────────────────────────────────────────────────────────
func _fire() -> void:
	for s in [-Tune.SHOT_COL_HALF, Tune.SHOT_COL_HALF]:
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
				dmg += Tune.SHOT_DMG
		if dmg > 0.0 and enemies.damage(j, dmg):
			continue
		j += 1

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
