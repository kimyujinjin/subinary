extends Node
## 오프셋 상대 드래그. 반증에서 나온 치명 3건의 수정이 전부 여기 있다.
##
## screen_relative(물리 px)만 쓴다 — relative 는 Camera2D·stretch 가 오염시키고,
## velocity/screen_velocity 는 최대 100ms 낡은 값이다.
## 앵커 자동 재설정은 하지 않는다: 매핑이 델타 기반이라 앵커 위치는 도달력에
## 아무 영향이 없다 — 무의미한 수정이다.

var units_per_px: float = 720.0 / 1080.0
var view_size: Vector2 = Vector2(Tune.PF_W, Tune.PF_H)

# ── 드래그 손가락
var drag_idx: int = -1
var drag_pos: Vector2 = Vector2.ZERO          # 유닛 (뷰포트 좌표)
var _pending_px: Vector2 = Vector2.ZERO       # 물리 px 누산 — 틱당 1회 소비
# 프레임당 이벤트 1개를 가정하지 않는다: accumulate() 는 버퍼 back() 하나에만
# 병합을 시도하고 index 가 다르면 실패한다. 드래그+폭탄 동시가 정확히 그 경우다.

# ── 집중 (이중탭 래치)
var focus: bool = false
var _press_tick: int = -9999
var _press_pos: Vector2 = Vector2.ZERO
var _tap_tick: int = -9999
var _tap_pos: Vector2 = Vector2.ZERO

# ── k 램프
var k: float = Tune.K_NORMAL
var _k_from: float = Tune.K_NORMAL
var _k_to: float = Tune.K_NORMAL
var _dwell: int = 0
var _ramp: int = 0

# ── 엣지 푸시
var edge_push: Vector2 = Vector2.ZERO         # u/s, 축별
var _edge_ramp: Vector2 = Vector2.ZERO        # 0..1

# ── 계측 (게이트 1 지표 ⑤)
var regrip_count: int = 0
var last_regrip_tick: int = -9999
var focus_toggles: int = 0

var _touch: Dictionary = {}                   # index -> Vector2 (유닛)

func _ready() -> void:
	_refresh_metrics()
	get_window().size_changed.connect(_refresh_metrics)

func _refresh_metrics() -> void:
	var win := DisplayServer.window_get_size()
	if win.x > 0:
		units_per_px = Tune.PF_W / float(win.x)
	view_size = get_viewport().get_visible_rect().size

## 물리 화면 폭(mm). k 는 유닛 공간의 무차원 이득이므로 이 값이 곧 조작감의 척도다.
## 설계의 "물리 폭 70mm 고정"은 태블릿 대응이고, 게이트 1 은 실측 표시까지만 한다.
func screen_width_mm() -> float:
	var dpi := DisplayServer.screen_get_dpi()
	if dpi <= 0:
		return 0.0
	return float(DisplayServer.window_get_size().x) / float(dpi) * 25.4

func _notification(what: int) -> void:
	# release_pressed_events() 는 키·조이패드·액션만 해제하고 터치는 손대지 않는다.
	# 세 알림 모두에서 터치 전체를 직접 클리어해야 유령 앵커가 남지 않는다.
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT \
			or what == NOTIFICATION_PAUSED \
			or what == NOTIFICATION_WM_GO_BACK_REQUEST:
		clear_touches()

func clear_touches() -> void:
	_touch.clear()
	drag_idx = -1
	_pending_px = Vector2.ZERO
	edge_push = Vector2.ZERO
	_edge_ramp = Vector2.ZERO

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		var t := event as InputEventScreenTouch
		if t.pressed:
			_touch[t.index] = t.position
			_on_press(t.index, t.position)
		else:
			# iOS 는 canceled 를 세팅하지 않고 position=(-1,-1) 의 release 를 보낸다.
			# 릴리스 좌표로 탭 판정을 하면 iOS 에서만 오작동하므로 마지막 알려진 좌표를 쓴다.
			var last: Vector2 = _touch.get(t.index, Vector2.ZERO)
			# Android 는 MotionEvent pointer id 원본을 재사용한다 — 반드시 지운다.
			_touch.erase(t.index)
			if t.index == drag_idx:
				_on_drag_release(last)
		get_viewport().set_input_as_handled()
	elif event is InputEventScreenDrag:
		var d := event as InputEventScreenDrag
		_touch[d.index] = d.position
		if d.index == drag_idx:
			_pending_px += d.screen_relative
			drag_pos = d.position
		get_viewport().set_input_as_handled()

func _excluded(p: Vector2) -> bool:
	# 무지구 접촉 + iOS 홈 인디케이터 + Android 제스처 내비. 팜은 다접촉으로 나타난다.
	return p.x < Tune.EXCL_SIDE or p.x > view_size.x - Tune.EXCL_SIDE \
			or p.y > view_size.y - Tune.EXCL_BOTTOM

func _on_press(idx: int, p: Vector2) -> void:
	if _touch.size() >= 3:
		return                                   # 동시 터치 3개 이상이면 역할 배정 전면 중단
	if drag_idx >= 0:
		return                                   # 두 번째 손가락은 게이트 1 에서 역할 없음
	if _excluded(p):
		return
	# 이중탭 래치 — 직전 탭과 창·거리 안이면 집중 토글
	if SimClock.wall_tick - _tap_tick <= Tune.TAP_WINDOW_TICKS \
			and p.distance_to(_tap_pos) <= Tune.TAP_MOVE_MAX:
		focus = not focus
		focus_toggles += 1
		_tap_tick = -9999
		_set_k(Tune.K_FOCUS if focus else Tune.K_NORMAL)
	drag_idx = idx
	drag_pos = p
	_press_tick = SimClock.wall_tick
	_press_pos = p
	_pending_px = Vector2.ZERO

func _on_drag_release(last: Vector2) -> void:
	var held := SimClock.wall_tick - _press_tick
	var moved := _press_pos.distance_to(last if last.x >= 0.0 else _press_pos)
	drag_idx = -1
	edge_push = Vector2.ZERO
	_edge_ramp = Vector2.ZERO
	if held <= Tune.TAP_HOLD_MAX_TICKS and moved <= Tune.TAP_MOVE_MAX:
		# 탭이다 — 이중탭 후보로 남긴다. 재파지로 세지 않는다.
		_tap_tick = SimClock.wall_tick
		_tap_pos = _press_pos
	else:
		# 의도치 않은 손 떼기 = 재파지. 이 동안 기체가 완전히 정지한다 (p50 180ms).
		regrip_count += 1
		last_regrip_tick = SimClock.wall_tick

func _set_k(target: float) -> void:
	if is_equal_approx(target, _k_to):
		return
	_k_to = target
	_dwell = Tune.K_DWELL_TICKS
	_ramp = 0

## 틱당 1회 소비. 기체 위치는 호출자가 클램프한다 —
## 가상 위치를 저장하면 화면 밖에서 손가락만 움직이는 유령 상태가 생긴다.
func consume(tick: int) -> Vector2:
	# k dwell → 램프
	if _dwell > 0:
		_dwell -= 1
		if _dwell == 0:
			_k_from = k
			_ramp = Tune.K_RAMP_TICKS
	elif _ramp > 0:
		_ramp -= 1
		k = lerpf(_k_to, _k_from, float(_ramp) / float(Tune.K_RAMP_TICKS))
	else:
		k = _k_to

	var d_units := _pending_px * units_per_px
	_pending_px = Vector2.ZERO

	# 엣지 푸시 — 손가락이 밴드 안에 있고 바깥 방향 델타면 그 축에 속도를 더한다.
	# 안쪽 델타 1개로 즉시 해제.
	if drag_idx >= 0:
		_edge_axis(0, drag_pos.x, d_units.x, view_size.x)
		_edge_axis(1, drag_pos.y, d_units.y, view_size.y)
	else:
		edge_push = Vector2.ZERO
		_edge_ramp = Vector2.ZERO

	var step := d_units * k + edge_push * Tune.DT
	return step.limit_length(Tune.MAX_STEP_PER_TICK)

func _edge_axis(axis: int, pos: float, delta: float, extent: float) -> void:
	var dir := 0.0
	if pos <= Tune.EDGE_BAND and delta < 0.0:
		dir = -1.0
	elif pos >= extent - Tune.EDGE_BAND and delta > 0.0:
		dir = 1.0
	var cur := _edge_ramp[axis]
	if dir != 0.0:
		cur = minf(1.0, cur + 1.0 / float(Tune.EDGE_RAMP_TICKS))
		_edge_ramp[axis] = cur
		edge_push[axis] = dir * Tune.EDGE_PUSH * cur
	elif delta != 0.0:
		_edge_ramp[axis] = 0.0                   # 안쪽 델타 1개로 해제
		edge_push[axis] = 0.0

## 남은 도달 여유(유닛) — 덱에 상시 표시한다. 축별 [좌, 우, 상, 하].
func reach_margin() -> Vector4:
	if drag_idx < 0:
		return Vector4.ZERO
	return Vector4(
		drag_pos.x * k,
		(view_size.x - drag_pos.x) * k,
		drag_pos.y * k,
		(view_size.y - drag_pos.y) * k)

func reset_run() -> void:
	regrip_count = 0
	last_regrip_tick = -9999
	focus_toggles = 0
	focus = false
	k = Tune.K_NORMAL
	_k_from = Tune.K_NORMAL
	_k_to = Tune.K_NORMAL
	_dwell = 0
	_ramp = 0
