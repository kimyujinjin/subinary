class_name Main
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
## 5분 6구역 타임라인(stage_full.tscn). 웨이브가 루프하지 않고 Stage.BOSS_AT 에서
## 보스가 합류한다 — 보스 러시와 같은 Boss 인스턴스이므로 페이즈·전단이 그대로 온다.
@export var stage_full: bool = false

const SCENE_STAGE := "res://scenes/main.tscn"
const SCENE_BOSS := "res://scenes/boss_rush.tscn"
const SCENE_FULL := "res://scenes/stage_full.tscn"
## 보스 접근 연출. 이 구간 동안 플레이어 하한이 내려온다 — 보스가 나타나는 순간
## 활동 영역이 522유닛 잘려 기체가 순간이동하는 것을 막는다(하강 74 u/s, 이동 속도의 1/5).
const BOSS_APPROACH := 420
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
var rescue_live: bool = false             # 이 창으로 정말 살 수 있는가(= 피격 시점의 재고)

# 자탄 — 조류 영향 없음, 관통. SoA.
var shot_x := PackedFloat32Array()
var shot_y := PackedFloat32Array()
var shot_n: int = 0

var enemies: EnemyField = null
var boss: Boss = null
var midboss: MidBoss = null
var _mb_view: MidBossView = null
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
var _shell: Shell = null
## 이번 런에서 피격이 일어난 구역 비트마스크 — 무피격 보너스 판정에 쓴다.
var _zone_hit_mask: int = 0
var _zone_seen_mask: int = 0
var _max_zone: int = 0
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
		_make_boss()
	_field.add_child(_bullets)
	_field.add_child(_overlay)
	_screen_ui = ScreenOverlay.new()
	_screen_ui.main = self
	_screen.add_child(_screen_ui)
	SaveData.load_now()
	Audio.setup(self)
	Audio.set_enabled(SaveData.sound_on)
	# 셸은 화면 오버레이보다 **위**에 있어야 한다 — 아래에 두면 HUD 가 메뉴를 덮는다.
	_shell = Shell.new()
	_shell.main = self
	_screen.add_child(_shell)
	# 러너·캡처는 게임 화면에서 곧바로 시작한다. 타이틀을 띄우면 그 도구들이 전부 멈춘다.
	if boss_mode or _headless_or_capture():
		_shell.screen = Shell.Screen.PLAY

	# 파이프라인 예열 30프레임(0.5초). 첫 탄이 뜨는 프레임의 컴파일 힛치를 미리 치른다 —
	# 첫 웨이브는 t=30 에 오므로 그 전에 끝난다.
	_bullets.warm(30)
	get_viewport().size_changed.connect(_on_resize)
	_on_resize()
	Difficulty.apply_from_cmdline()
	Cast.apply_from_cmdline()
	_parse_capture()
	_reset(FIXED_SEED)
	# run 행은 **런이 시작될 때** 쓴다(begin_run). 기동 시 쓰면 그때는 아직 타이틀이라
	# diff= 가 항상 커맨드라인 기본값(Normal)으로 박히고, 실기 로그의 난이도가 거짓이 된다.
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

## 타이틀을 건너뛰어야 하는 실행인가. 캡처·헤드리스·자동화는 입력이 없으므로
## 메뉴에서 영원히 멈춘다 — 그 실행들의 판정이 통째로 무효가 된다.
func _headless_or_capture() -> bool:
	if DisplayServer.get_name() == "headless":
		return true
	var args := OS.get_cmdline_user_args()
	args.append_array(OS.get_cmdline_args())
	for a in args:
		if a.begins_with("--capture=") or a == "--cap-rescue" or a.begins_with("--boss-phase="):
			return true
	return false

## 셸이 뜨고 질 때 부른다. 띠 제스처가 들고 있던 손가락을 놓지 않으면
## 그 index 의 drag 를 _debug_toggle 이 계속 소비해 다음 런에서 기체가 안 움직인다.
func drop_band_touches() -> void:
	_band_idx.clear()
	_toggle_taps = 0

func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST or what == NOTIFICATION_PREDELETE:
		SaveData.save_now()

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
	if _shell != null:
		_shell.vh = vh
		_shell.view_w = view_w
		_shell.queue_redraw()
	# view_size 를 직접 대입하면 _refresh_metrics 가 덮는다 — 높이 오버라이드로 전달한다.
	TouchRouter.view_h_override = vh if forced else 0.0
	TouchRouter._refresh_metrics()

func _reset(seed_value: int, start_tick: int = 0) -> void:
	SimClock.reset(seed_value)
	SimClock.sim_tick = start_tick
	_zone_hit_mask = 0
	_zone_seen_mask = 0
	_max_zone = 0
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
	# 연습 구역에서 시작하면 그 전 웨이브는 이미 지나간 것으로 친다 —
	# 커서를 0 으로 두면 지난 웨이브가 첫 틱에 한꺼번에 쏟아진다.
	_wave_cursor = 0
	if stage_full and start_tick > 0:
		while _wave_cursor < Stage.STAGE_WAVES.size() \
				and int(Stage.STAGE_WAVES[_wave_cursor][0]) < start_tick:
			_wave_cursor += 1
	invincible_left = INVINCIBLE_TICKS
	player = Vector2(Tune.PF_W * 0.5, Tune.PF_H * 0.78)
	player_prev = player
	lesson_step = 0
	lesson_hold = 0
	_restart_armed = false
	_clear_left = -1
	clear_anim = -1
	if midboss != null:
		# 뷰의 존재를 가정하지 않는다. _make_midboss 가 항상 짝지어 만들지만,
		# 짝이 깨진 상태에서 _reset 이 불리면 여기서 죽으면서 **런 전체가 멈춘다** —
		# 정리 코드가 정리하다 죽으면 안 된다.
		if _mb_view != null:
			_field.remove_child(_mb_view)
			_mb_view.queue_free()
		_mb_view = null
		midboss = null
		BulletField.reset_flow()
	if stage_full and boss != null:
		# remove_child 를 먼저 한다. queue_free 는 다음 프레임이라 그 사이 한 번 더 그려지고,
		# 그때 boss 는 이미 null 이다.
		if _boss_view != null:
			_field.remove_child(_boss_view)
			_boss_view.queue_free()
		_boss_view = null
		boss = null
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
		# 띠의 오른쪽 끝 90유닛은 **일시정지 전용**이다. 이 경로가 없으면 런을 시작한 뒤
		# 나오는 방법이 라이프 3개를 다 잃는 것뿐이다 — 잘못 고른 난이도로 5분을 갇힌다.
		# 3연타 판정에서 빼지 않으면 일시정지를 누르려다 장면이 바뀐다.
		if _shell != null and not boss_mode and t.position.x >= view_w - 90.0:
			_band_idx[t.index] = true
			_shell._go(Shell.Screen.PAUSE)
			return true
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

## 30초 루프 → 보스 러시 → 5분 풀 스테이지 → 30초 루프.
func _switch_scene() -> void:
	RunLog.flush()
	var next := SCENE_BOSS
	if boss_mode:
		next = SCENE_FULL
	elif stage_full:
		next = SCENE_STAGE
	get_tree().change_scene_to_file.call_deferred(next)

func _unhandled_input(event: InputEvent) -> void:
	if _shell != null and _shell.handle(event):
		get_viewport().set_input_as_handled()
		return
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
	# 셸(타이틀·일시정지·결과…)이 떠 있으면 시뮬이 한 틱도 돌지 않는다.
	# 시간만 멈추는 게 아니라 begin_tick 자체를 건너뛴다 — 벽시계 틱이 흐르면
	# 재시작 어포던스 깜빡임과 구제 창이 메뉴 뒤에서 조용히 만료된다.
	if _shell != null and not _shell.playing():
		return
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
			Audio.play(Audio.Sfx.BOMB)
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
	player.y = clampf(player.y, _player_min_y(tick), Tune.PF_H - Tune.MARGIN)
	if stage_full:
		var z := Stage.zone_of(tick)
		_zone_seen_mask |= 1 << z
		_max_zone = maxi(_max_zone, z)
	_log_regrips(tick)

	# 2. 자탄 (자동 사격)
	if tick % Tune.SHOT_PERIOD_TICKS == 0:
		_fire()
	_step_shots()

	# 3. 웨이브 → 적 → 이미터. 보스가 합류해도 남은 적은 계속 움직인다 —
	# 멈추면 화면 중간에 굳은 몸통이 남고, 그 몸통의 탄만 살아 움직인다.
	_spawn_waves(tick)
	if boss != null:
		var ph0 := boss.phase
		boss.step(tick, player)
		# 페이즈 전환음은 **시뮬 밖에서** 관찰해 울린다. Boss 가 직접 Audio 를 부르면
		# 헤드리스 러너가 오디오 서버를 건드리고 시뮬이 연출에 의존하게 된다.
		if boss.phase != ph0:
			Audio.play(Audio.Sfx.PHASE)
	if midboss != null:
		var mph0 := midboss.phase
		midboss.step(tick, player)
		if midboss.phase != mph0:
			Audio.play(Audio.Sfx.PHASE)
	enemies.step(tick, player)

	# 4. 자탄 — 보스·중간보스가 먼저 먹는다(관통 없음). 남은 자탄이 적을 관통한다.
	if boss != null:
		_shots_vs_boss(tick)
	if midboss != null:
		_shots_vs_midboss(tick)
	_shots_vs_enemies()

	# 4-1. 중간보스 격파 처리는 **자탄 경로 밖**에 둔다.
	# _shots_vs_midboss 안에서만 부르고 있었는데 그 함수는 첫 줄에서 done 이면 return 한다.
	# 중간보스는 시간 상한으로도 죽고(P3 는 105 HP 를 8초에 깎아야 해서 그쪽이 기본 결말이다),
	# 그때는 step 3 에서 done 이 켜지므로 step 4 가 즉시 return 해 보상이 통째로 유실됐다 —
	# 폭탄 리필도 광립 60개도 40,000점도 안 나오고, 노드가 null 이 안 돼 남은 3분 동안
	# HUD 에 죽은 중간보스가 계속 붙어 있었다. 보스는 _step_boss_clear 가 자탄 밖에서 본다.
	if midboss != null and midboss.done:
		_kill_midboss(tick)

	# 4a. 격파 보상 — 적이 종류별 광립 수를 값으로 남긴다(인덱스는 이미 재배정됐다)
	for kill in enemies.kills:
		_drop_motes(kill[0].x, kill[0].y, int(kill[1]))
		Audio.play(Audio.Sfx.KILL)
	enemies.kills.clear()

	# 4b. 광립 — 조류를 타고 부상하다 2초 뒤 기체로 온다. 회수 판정은 graze 링.
	motes.step(tick, player)
	if motes.collected > 0:
		score += motes.collected * int(round(float(Tune.SCORE_MOTE) * _risk_mult()))
		Audio.play(Audio.Sfx.MOTE)

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
		Audio.play(Audio.Sfx.GRAZE)

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
		Audio.play(Audio.Sfx.CLEAR)
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
			# 보스를 잡았다 = **클리어**다. _restart() 로 보내면 finish_run(false) 로 떨어져
			# 결과 화면이 승리한 런에 "RUN OVER" 를 찍고 cleared_mask 가 영원히 0 이라
			# Hard 가 절대 해금되지 않는다(실측: 러너는 finish_run(true) 를 직접 불러 통과했다).
			if _shell != null and not boss_mode:
				finish_run(true)
			else:
				_reset(FIXED_SEED)
			return true
	return false

func _redraw_all(tick: int) -> void:
	_backdrop.tick = tick
	_backdrop.queue_redraw()
	if _boss_view != null:
		_boss_view.tick = tick
		_boss_view.queue_redraw()
	if _mb_view != null:
		_mb_view.tick = tick
		_mb_view.queue_redraw()
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
	var r_left := SimClock.rescue_left     # 아래에서 0 으로 지우므로 **먼저** 잡는다
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
			"rescue=%d;left=%d;bombs=%d" % [1 if rescued else 0, r_left, bombs]])
	return true

# ── 피격 · 사망 ─────────────────────────────────────────────────────────
## 피격 = 구제 창을 여는 것이지 사망이 아니다. 창 안에 폭탄을 누르면 취소된다.
func _on_hit() -> void:
	_pending_death = true
	# 창을 여는 것은 "구할 수 있다" 는 약속이다. 재고가 없으면 그 약속을 지킬 수 없는데
	# 지금까지 **똑같이 생긴 창**을 열었다 — 실기 사망 3건 전부 bombs=0 이었고,
	# 플레이어는 살아난 창과 못 살아난 창을 구별할 방법이 없었다. 그러면 이 창에서
	# 무엇을 배워야 하는지가 영영 학습되지 않는다. 정지 시간 자체는 사망에도 쓸모가
	# 있으므로 창은 그대로 두고 **색과 소리로 갈라 말한다.**
	rescue_live = bombs > 0
	if stage_full:
		_zone_hit_mask |= 1 << Stage.zone_of(SimClock.sim_tick)
	Audio.play(Audio.Sfx.RESCUE if rescue_live else Audio.Sfx.HIT)
	lesson_bid = BulletField.hit_bid
	lesson_death_pos = player
	SimClock.rescue(Tune.RESCUE_TICKS)
	TouchRouter.rescue_watch_begin()
	RunLog.write("hit", [SimClock.run_index, SimClock.sim_tick, SimClock.run_seed,
			player.x, player.y, Tune.KIND_NAMES[clampi(BulletField.hit_kind, 0, Tune.KIND_N - 1)],
			lesson_bid, fairness.gap_x0, fairness.gap_w,
			TouchRouter.k, TouchRouter.focus, TouchRouter.regrip_count, 0,
			BulletField.flow_c(SimClock.sim_tick), 0.0, BulletField.n,
			int(Engine.get_frames_per_second()), "", 0.0, 0.0,
			"bombs=%d;lives=%d" % [bombs, lives]])

func _on_death() -> void:
	Audio.play(Audio.Sfx.HIT)
	deaths += 1
	_pending_death = false
	lives -= 1
	lesson_step = -1        # 첫 되감기 틱에 0 이 된다 — 가장 오래된 프레임부터 보여준다
	lesson_hold = 0
	_restart_armed = false
	var since := -1 if TouchRouter.last_regrip_tick < 0 else SimClock.wall_tick - TouchRouter.last_regrip_tick
	RunLog.write("death", [SimClock.run_index, SimClock.sim_tick, SimClock.run_seed,
			player.x, player.y, Tune.KIND_NAMES[clampi(BulletField.hit_kind, 0, Tune.KIND_N - 1)],
			lesson_bid, fairness.gap_x0, fairness.gap_w,
			TouchRouter.k, TouchRouter.focus, TouchRouter.regrip_count, since,
			BulletField.flow_c(SimClock.sim_tick),
			BulletField.flow_u(player.y, SimClock.sim_tick),
			BulletField.n, int(Engine.get_frames_per_second()), "", 0.0, 0.0,
			"relay=%d;lives=%d;bombs=%d;score=%d;rpress=%d;rrel=%d;rfirst=%d;rzone=%d;zone=%d" % [
				TouchRouter.relay_count, lives, bombs, score,
				TouchRouter.rescue_presses, TouchRouter.rescue_releases,
				TouchRouter.rescue_first_tick,
				1 if TouchRouter.rescue_first_zone else 0,
				# 구역 번호는 게임이 쓴다. 판정 스크립트가 틱으로 다시 계산하면
				# 경계표가 두 벌이 되고, 갈라진 쪽이 틀린 판정을 자신 있게 낸다.
				(Stage.zone_of(SimClock.sim_tick) + 1) if stage_full else 0]])
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

## 셸이 "시작" 을 눌렀을 때 부른다. 연습 구역이 지정돼 있으면 그 구역의 첫 틱에서 연다.
func begin_run() -> void:
	_log_run_header()
	var z: int = _shell.practice_zone if _shell != null else -1
	_reset(FIXED_SEED, Stage.zone_of_start(z) if (stage_full and z >= 0) else 0)
	Audio.music(SaveData.sound_on)
	_redraw_all(SimClock.sim_tick)

## 런이 끝났다 — 결과 화면으로. 라이프 소진·클리어 둘 다 여기로 온다.
func finish_run(cleared: bool) -> void:
	SaveData.submit_score(Difficulty.level, score)
	if cleared:
		SaveData.mark_cleared(Difficulty.level)
	# 이번 런에서 지나갔고 한 번도 안 맞은 구역을 점등한다. 지나가지 않은 구역은 안 센다.
	for z in Stage.ZONES.size():
		if (_zone_seen_mask & (1 << z)) != 0 and (_zone_hit_mask & (1 << z)) == 0:
			SaveData.mark_zone_clean(z)
	SaveData.save_now()
	Audio.music(false)
	Audio.play(Audio.Sfx.CLEAR if cleared else Audio.Sfx.HIT)
	if _shell != null:
		_shell.result_score = score
		_shell.result_cleared = cleared
		_shell.result_zone = _max_zone
		_shell._go(Shell.Screen.RESULT)

func _restart() -> void:
	if _shell != null and not boss_mode:
		finish_run(false)
		return
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
	if _mb_view != null:
		# 중간보스 줄무늬도 같은 이유로 되돌린다. 사망 틱에 고정하면 교재의 탄은 0.5초 과거인데
		# 줄무늬는 사망 시점 각도라, "물의 상태가 몸에 그려져 있다" 가 교재에서만 거짓이 된다.
		_mb_view.tick = replay.frame_tick(clampi(lesson_step, 0, maxi(replay.length() - 1, 0)))
		_mb_view.queue_redraw()
	_overlay.queue_redraw()
	_screen_ui.queue_redraw()

# ── 자탄 ────────────────────────────────────────────────────────────────
func _fire() -> void:
	# 집중이면 2열이 1줄로 수렴한다(설계서 §3). 대미지는 _shot_dmg() 가 1.4배로 올린다.
	# 조종사마다 2열의 폭이 다르다. 집중하면 두 사람 다 한 줄로 모인다 —
	# 집중은 "폭을 버리고 화력을 얻는다" 는 공통 규칙이고, 그 교환비만 사람마다 다르다.
	var half: float = 2.0 if TouchRouter.focus else Cast.col_half()
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
	return Cast.shot_dmg(TouchRouter.focus)

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

## 자탄 대 중간보스 — 보스와 같은 규칙(관통 없음, 한 발 = 1). 판정만 축정렬 사각형이다.
func _shots_vs_midboss(tick: int) -> void:
	if midboss.done:
		return
	var i := 0
	while i < shot_n:
		if midboss.hit(shot_x[i], shot_y[i], Tune.SHOT_R):
			midboss.damage(_shot_dmg(), tick, player)
			shot_n -= 1
			shot_x[i] = shot_x[shot_n]
			shot_y[i] = shot_y[shot_n]
			continue
		i += 1

# ── 웨이브 ──────────────────────────────────────────────────────────────
## 보스 등장 전까지 플레이어가 올라갈 수 있는 y 하한. 보스 접근 구간에서 선형으로 내려온다.
func _player_min_y(tick: int) -> float:
	var base := Tune.MARGIN + Backdrop.BAND_H
	if boss_mode:
		return Boss.PLAYER_MIN_Y
	if not stage_full:
		return base
	var d := Stage.BOSS_AT - tick
	if d <= 0:
		return Boss.PLAYER_MIN_Y
	if d >= BOSS_APPROACH:
		return base
	return lerpf(Boss.PLAYER_MIN_Y, base, float(d) / float(BOSS_APPROACH))

## 전투 전 대사를 띄운다. 시뮬은 셸이 떠 있는 동안 한 틱도 안 돈다 —
## 대사가 끝나면 **그 틱 그대로** 이어진다(읽는 동안 탄이 날아오면 대사가 벌이 된다).
## 연습 모드에서는 띄우지 않는다: 같은 구역을 반복하는데 매번 대사를 보게 하면 방해다.
func _talk(script_: Array, opponent: int) -> void:
	if _shell == null or boss_mode or _shell.practice_zone >= 0:
		return
	_shell.talk_script = script_
	_shell.talk_opponent = opponent
	_shell.talk_line = 0
	_shell._go(Shell.Screen.TALK)

func _make_boss() -> void:
	boss = Boss.new()
	boss.reset(SimClock.sim_tick)
	_boss_view = BossView.new()
	_boss_view.boss = boss
	_field.add_child(_boss_view)
	_field.move_child(_boss_view, 1)   # 배경 바로 위 = 탄 레이어 아래. 탄이 몸통 위를 지나간다
	_talk(Cast.BOSS_TALK, 3)

func _make_midboss(tick: int) -> void:
	midboss = MidBoss.new()
	midboss.reset(tick)
	_mb_view = MidBossView.new()
	_mb_view.mb = midboss
	_field.add_child(_mb_view)
	_field.move_child(_mb_view, 1)     # 배경 바로 위 = 탄 레이어 아래
	_talk(Cast.MID_TALK, 2)

## 격파 보상 — 광립 60개 상승 + 폭탄 최대치 리필(설계서 §6).
## 폭탄을 여기서 채우는 이유: 중간보스 직후가 보상 회랑이고, 그 뒤 구역 5·보스로
## 들어가기 때문이다. 리필이 없으면 전반부에서 폭탄을 쓴 사람이 후반부를 맨손으로 간다.
func _kill_midboss(tick: int) -> void:
	Audio.play(Audio.Sfx.PHASE)
	_drop_motes_ring(MidBoss.CX, MidBoss.CY, 90.0, 60)
	bombs = Tune.BOMBS
	score += Tune.SCORE_MIDBOSS
	RunLog.write("note", [SimClock.run_index, tick, SimClock.run_seed,
			int(MidBoss.CX), int(MidBoss.CY), 0, 0, 0, 0, 0, false, 0, 0, 0.0, 0.0,
			BulletField.n, 0, "", 0.0, 0.0,
			"midboss=%s;t=%.2f" % [midboss.done_reason, float(midboss.elapsed(tick)) / 60.0]])
	_field.remove_child(_mb_view)
	_mb_view.queue_free()
	_mb_view = null
	midboss = null

func _spawn_waves(tick: int) -> void:
	if boss_mode:
		return
	if stage_full:
		_spawn_stage(tick)
		return
	var loop_t := tick % Stage.LOOP_TICKS
	if loop_t == 0:
		_wave_cursor = 0
	while _wave_cursor < Stage.WAVES.size():
		var w: Array = Stage.WAVES[_wave_cursor]
		if int(w[0]) > loop_t:
			break
		enemies.spawn_wave(tick, w)
		_wave_cursor += 1

## 5분 타임라인. 루프하지 않는다 — 커서는 리셋에서만 0 으로 돌아간다.
func _spawn_stage(tick: int) -> void:
	if boss == null and tick >= Stage.BOSS_AT:
		_make_boss()
	while _wave_cursor < Stage.STAGE_WAVES.size():
		var w: Array = Stage.STAGE_WAVES[_wave_cursor]
		if int(w[0]) > tick:
			break
		if int(w[1]) == Stage.KIND_MIDBOSS:
			_make_midboss(tick)
			_wave_cursor += 1
			continue
		enemies.spawn_wave(tick, w)
		_wave_cursor += 1

func _mode_tag() -> String:
	if boss_mode:
		return "boss"
	return "full" if stage_full else "stage"


## 이 런의 헤더 한 줄. 판정 스크립트가 첫 행에서 mode·diff 를 읽는다.
func _log_run_header() -> void:
	RunLog.write("run", [SimClock.run_index, 0, SimClock.run_seed, 0, 0, "", 0, 0, 0,
			0.0, false, 0, 0, 0.0, 0.0, 0, 0, _build_tag(),
			TouchRouter.field_per_px, TouchRouter.screen_width_mm(),
			"mode=%s;diff=%s" % [_mode_tag(), Difficulty.name_of()]])
