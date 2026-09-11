extends Node2D
## 패턴 갤러리 — 패턴 하나를 격리해서 본다. 로드맵 4단계 항목.
##
## 게임 안에서는 패턴이 적·보스의 스케줄에 얹혀 나오므로 "이 패턴 자체가 어떻게 생겼나" 를
## 볼 방법이 없다. 여기서는 Patterns.BOOK 을 그대로 순회하며 한 겹씩 단독으로 돌린다 —
## 공정성 러너가 판정하는 것과 **같은 emit_solo** 를 쓰므로 화면과 숫자가 갈라지지 않는다.
##
## 조작: 화면 좌/우 절반 탭 = 이전/다음 패턴 · 데스크톱 ←/→. 위쪽 1/4 탭 = 일시정지.
## 기체는 드래그로 움직인다(판정은 켜져 있고, 맞아도 죽지 않는다 — 관찰이 목적이다).

var idx: int = 0
var local: int = 0
var paused: bool = false
var player: Vector2 = Vector2(Tune.PF_W * 0.5, 1000.0)
var _fair: Fairness = null
var _backdrop: Backdrop = null
var _bullets: BulletRenderer = null
var _hud: Node2D = null

## --gallery-shot=<패턴번호>:<틱>:<경로> — 갤러리 한 장면을 캡처한다(도구 검증용).
var _shot_idx := -1
var _shot_tick := 0
var _shot_path := ""

func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--gallery-shot="):
			var v := a.substr(15).split(":")
			if v.size() == 3:
				_shot_idx = int(v[0]); _shot_tick = int(v[1]); _shot_path = v[2]
	_fair = Fairness.new()
	_backdrop = Backdrop.new()
	_bullets = BulletRenderer.new()
	add_child(_backdrop)
	add_child(_bullets)
	_hud = GalleryHud.new()
	_hud.gallery = self
	add_child(_hud)
	get_viewport().size_changed.connect(_on_resize)
	_on_resize()
	if _shot_idx >= 0:
		idx = clampi(_shot_idx, 0, Patterns.BOOK.size() - 1)
	_reset()

## 배경은 가시영역 전체를 덮어야 한다 — 안 하면 플레이필드 아래가 클리어 컬러로 남는다.
func _on_resize() -> void:
	var vis := get_viewport().get_visible_rect().size
	_backdrop.vh = vis.y
	_hud.vh = vis.y

func _reset() -> void:
	BulletField.clear()
	local = 0
	player = Vector2(Tune.PF_W * 0.5, 1000.0)

func _step_pattern(by: int) -> void:
	idx = wrapi(idx + by, 0, Patterns.BOOK.size())
	_reset()

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and (event as InputEventKey).pressed:
		var k := (event as InputEventKey).keycode
		if k == KEY_RIGHT: _step_pattern(1)
		elif k == KEY_LEFT: _step_pattern(-1)
		elif k == KEY_SPACE: paused = not paused
		elif k == KEY_R: _reset()
	elif event is InputEventScreenTouch and (event as InputEventScreenTouch).pressed:
		var p := (event as InputEventScreenTouch).position
		if p.y < Tune.PF_H * 0.25:
			paused = not paused
		else:
			_step_pattern(1 if p.x > Tune.PF_W * 0.5 else -1)

func _physics_process(_delta: float) -> void:
	SimClock.begin_tick()
	var tick := SimClock.sim_tick
	if not paused:
		var prev := player
		player += TouchRouter.consume(tick)
		player.x = clampf(player.x, Tune.MARGIN, Tune.PF_W - Tune.MARGIN)
		player.y = clampf(player.y, Tune.MARGIN + Backdrop.BAND_H, Tune.PF_H - Tune.MARGIN)
		Patterns.emit_solo(idx, local, tick, player)
		BulletField.step_and_collide(tick, prev, player, true)   # 관찰용 — 죽지 않는다
		_fair.scan(BulletField, player.x, player.y)
		local += 1
		var period := int(Patterns.BOOK[idx]["solo_period"]) * 4 + 420
		if local > period:
			_reset()
	_backdrop.tick = tick
	_backdrop.queue_redraw()
	_bullets.queue_redraw()
	_hud.queue_redraw()
	if _shot_idx >= 0 and local >= _shot_tick:
		_shot_idx = -1
		_capture.call_deferred()

func _capture() -> void:
	await RenderingServer.frame_post_draw
	var err := get_viewport().get_texture().get_image().save_png(_shot_path)
	print("gallery shot -> %s (err %d)" % [_shot_path, err])
	get_tree().quit(0 if err == OK else 1)

func gap_w() -> int:
	return _fair.gap_w if _fair.in_band > 0 else -1
