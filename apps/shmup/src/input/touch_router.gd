extends Node
## 오프셋 상대 드래그. 반증에서 나온 치명 3건의 수정이 전부 여기 있다.
##
## screen_relative(물리 px)만 쓴다 — relative 는 Camera2D·stretch 가 오염시키고,
## velocity/screen_velocity 는 최대 100ms 낡은 값이다.
## 앵커 자동 재설정은 하지 않는다: 매핑이 델타 기반이라 앵커 위치는 도달력에
## 아무 영향이 없다 — 무의미한 수정이다.

## 물리 px → 유닛. 가시영역 / 창 픽셀로 직접 유도한다.
##
## 실측(tools/viewport_probe.gd): stretch = canvas_items + expand 는 여유가 있는 축을 늘리고
## 절대 자르지 않는다. 폰(9:19.5)은 폭 720 고정·높이 1555~1562, 태블릿(1640x2360)은
## **폭이 889 로 늘고 높이가 1280 고정**이다. 설계서의 "폭은 모든 폰에서 정확히 720유닛"은
## 폰에서만 참이다.
##
## 그래서 720/창폭 으로 계산하면 태블릿에서 23% 어긋난다(0.878 대 실제 1.084).
var field_per_px: float = 1.0
var view_size: Vector2 = Vector2(Tune.PF_W, Tune.PF_H)
## 오버라이드가 적용되지 않은 실제 가시영역. 엣지 푸시와 도달 여유는 "손가락이 **물리**
## 화면 끝에 닿는가" 를 다루므로 가상 16:9 높이를 쓰면 안 된다 —
## --force-16x9 로 돌리면 하단 밴드가 420유닛 전역 최대 세기로 뒤집혔다.
## 덱·폭탄존·제외영역은 화면에 그려지는 것과 같아야 하므로 view_size(오버라이드 적용)를 쓴다.
var view_phys: Vector2 = Vector2(Tune.PF_W, Tune.PF_H)
## 0 이 아니면 뷰포트 높이를 이 값으로 간주한다(--force-16x9). _refresh_metrics 가
## 크기 변경마다 view_size 를 다시 쓰므로 외부에서 view_size 를 대입하면 덮여 버린다.
var view_h_override: float = 0.0

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
var _press_live: bool = true

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
var relay_count: int = 0
## 이번 틱에 폭탄 입력이 있었는가 — 두 번째 손가락 press. Main 이 소비하고 비운다.
## 설계서 §3: 집중과 폭탄이 같은 엄지를 요구하면 위기 중 폭탄 입력이 감도 점프를 유발한다.
## 그래서 집중은 드래그 손가락 이중탭, 폭탄은 두 번째 손가락으로 채널을 나눴다.
var bomb_pressed: bool = false

## 구제 창 계측 — "안 눌렀다 / 늦었다 / 엉뚱한 데 눌렀다" 를 가른다.
## 실기 1차에서 구제 성공률이 0% 였는데 로그로는 셋을 구별할 수 없었다.
## 창이 열릴 때 Main 이 rescue_watch_begin() 을 부르고, 사망 시 이 값을 남긴다.
var rescue_presses: int = 0
var rescue_first_tick: int = -1     ## 창이 열린 뒤 첫 press 까지의 벽시계 틱
var rescue_first_zone: bool = false ## 그 press 가 폭탄 히트영역 안이었는가
var _rescue_open_tick: int = -1

func rescue_watch_begin() -> void:
	rescue_presses = 0
	rescue_first_tick = -1
	rescue_first_zone = false
	_rescue_open_tick = SimClock.wall_tick
## 재파지 원인 기록. 실기에서 3회/분(목표 0.1)이 나왔는데 로그로는 원인을 가를 수 없었다 —
## 도달 여유가 바닥났는지, 제외 영역에 걸렸는지, 그냥 습관인지. 떼는 순간의 손가락 위치·
## 누른 시간·축별 도달 여유를 남긴다. Main 이 틱마다 비워 RunLog 에 쓴다.
var regrip_events: Array = []

var _touch: Dictionary = {}                   # index -> Vector2 (뷰포트 유닛)
var _touch_delta: Dictionary = {}             # index -> Vector2 (물리 px, 이 프레임)

func _ready() -> void:
	_refresh_metrics()
	get_window().size_changed.connect(_refresh_metrics)

func _refresh_metrics() -> void:
	var win := DisplayServer.window_get_size()
	view_size = get_viewport().get_visible_rect().size
	view_phys = view_size                        # 덮기 전에 보관
	if win.x > 0:
		field_per_px = view_size.x / float(win.x)
	if view_h_override > 0.0:
		view_size.y = view_h_override            # 존(_excluded·_bomb_zone)에만 적용

## 물리 화면 폭(mm) — **추정치다. 판정에 그대로 쓰지 말 것.**
##
## k 는 유닛 공간의 무차원 이득이므로 이 값이 곧 조작감의 척도이고,
## 설계의 "물리 폭 70mm 고정"도 이 값을 알아야 성립한다. 그런데
## DisplayServer.screen_get_dpi() 는 Android 에서 **논리 density 버킷**을 돌려준다 —
## Galaxy S25+ 실측: 보고 480 → 57.1mm 인데 실제 xDpi 409.4 → 67.0mm. 17% 과소보고다.
## 엔진 API 로는 물리 DPI 를 얻을 수 없으므로 실측값을 --screen-mm=<값> 으로 주입한다.
##   adb shell dumpsys display | grep xDpi
var screen_mm_override: float = 0.0

func screen_width_mm() -> float:
	if screen_mm_override > 0.0:
		return screen_mm_override
	var dpi := DisplayServer.screen_get_dpi()
	if dpi <= 0:
		return 0.0
	return float(DisplayServer.window_get_size().x) / float(dpi) * 25.4

## 값이 실측 주입인가. HUD 가 추정치와 실측을 구분해 표시한다.
func screen_mm_measured() -> bool:
	return screen_mm_override > 0.0

func _notification(what: int) -> void:
	# release_pressed_events() 는 키·조이패드·액션만 해제하고 터치는 손대지 않는다.
	# 세 알림 모두에서 터치 전체를 직접 클리어해야 유령 앵커가 남지 않는다.
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT \
			or what == NOTIFICATION_PAUSED \
			or what == NOTIFICATION_WM_GO_BACK_REQUEST:
		clear_touches()

func clear_touches() -> void:
	_touch.clear()
	_touch_delta.clear()
	drag_idx = -1
	_pending_px = Vector2.ZERO
	edge_push = Vector2.ZERO
	_edge_ramp = Vector2.ZERO

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		var t := event as InputEventScreenTouch
		if t.pressed:
			if SimClock.state == SimClock.State.RESCUE:
				rescue_presses += 1
				if rescue_first_tick < 0:
					rescue_first_tick = SimClock.wall_tick - _rescue_open_tick
					rescue_first_zone = _bomb_zone(t.position)
			_touch[t.index] = t.position
			_touch_delta[t.index] = Vector2.ZERO
			_on_press(t.index, t.position)
		else:
			# iOS 는 canceled 를 세팅하지 않고 position=(-1,-1) 의 release 를 보낸다.
			# 릴리스 좌표로 탭 판정을 하면 iOS 에서만 오작동하므로 마지막 알려진 좌표를 쓴다.
			var last: Vector2 = _touch.get(t.index, Vector2.ZERO)
			# Android 는 MotionEvent pointer id 원본을 재사용한다 — 반드시 지운다.
			_touch.erase(t.index)
			_touch_delta.erase(t.index)
			if t.index == drag_idx:
				if not _relay():
					_on_drag_release(last)
		get_viewport().set_input_as_handled()
	elif event is InputEventScreenDrag:
		var d := event as InputEventScreenDrag
		# press 를 못 본 index 는 우리 것이 아니다 — 상위 노드가 그 press 를 소비했다.
		# 이 가드가 없으면 _touch 에 유령 항목이 남고 릴레이가 그리로 넘어간다(2차 방어선).
		if not _touch.has(d.index):
			return
		_touch[d.index] = d.position
		_touch_delta[d.index] = _touch_delta.get(d.index, Vector2.ZERO) + d.screen_relative
		if d.index == drag_idx:
			_pending_px += d.screen_relative
			drag_pos = d.position
		get_viewport().set_input_as_handled()

func _excluded(p: Vector2) -> bool:
	# 무지구 접촉 + iOS 홈 인디케이터 + Android 제스처 내비. 팜은 다접촉으로 나타난다.
	return p.x < Tune.EXCL_SIDE or p.x > view_size.x - Tune.EXCL_SIDE \
			or p.y > view_size.y - Tune.EXCL_BOTTOM

## 폭탄 히트영역. 평시에는 우하단 원, 구제 창 동안에는 덱 하단 240유닛 전역 —
## 그 순간 팜 오접촉은 "공짜 구제" 라 오탐 방향이 플레이어에게 유리하다.
func _bomb_zone(p: Vector2) -> bool:
	if SimClock.state == SimClock.State.RESCUE:
		return p.y >= view_size.y - Tune.DECK_H
	var c := Vector2(view_size.x - Tune.BOMB_CX_FROM_RIGHT, view_size.y - Tune.BOMB_CY_FROM_BOTTOM)
	return p.distance_to(c) <= Tune.BOMB_R

func _on_press(idx: int, p: Vector2) -> void:
	# 구제 창의 폭탄은 **동시 터치 가드보다 앞이다.** 가드 뒤에 두면 덱에 팜이나 릴레이
	# 대기 손가락이 얹혀 있을 때 창 안 폭탄 press 가 조용히 버려진다 —
	# "창 동안 팜 오접촉은 공짜 구제" 라는 확정사항이 정확히 반대로 뒤집힌다.
	# 구제 창 동안에는 덱 전역이 폭탄이다 — **몇 번째 손가락인지 묻지 않는다.**
	# 처음엔 "두 번째 손가락" 조건을 붙였는데, 엄지를 떼고 있던 순간에 맞으면
	# 그 press 가 드래그 배정으로 흘러가 폭탄이 나가지 않았다. 실기 3회 피격 모두
	# 구제 실패(bombs=2 그대로)였고 로그로는 "안 눌렀다" 와 구별되지 않았다.
	# 창은 333ms 다 — 이 순간 입력을 조건부로 만들면 그 기능은 없는 것과 같다.
	if SimClock.state == SimClock.State.RESCUE and _bomb_zone(p):
		bomb_pressed = true
		if drag_idx >= 0 or _touch.size() >= 3:
			return
		# 화면에 드래그 손가락이 없었다면 이 손가락이 이어받는다 — 구제 직후
		# 조작이 끊기면 살려 준 의미가 없다.
		drag_idx = idx
		drag_pos = p
		_press_tick = SimClock.wall_tick
		_press_pos = p
		_press_live = true
		_pending_px = Vector2.ZERO
		return

	if _touch.size() >= 3:
		return                                   # 동시 터치 3개 이상이면 역할 배정 전면 중단
	if drag_idx >= 0:
		# 두 번째 손가락 — 폭탄 채널. 드래그 역할은 넘어가지 않는다(릴레이는 릴리스 때만).
		if _bomb_zone(p):
			bomb_pressed = true
		return
	if _excluded(p):
		return
	# 사망 화면의 press 는 재시작 탭이다. 드래그 역할은 준다 — 그 손가락으로 곧바로
	# 조작을 이어가야 하기 때문이다(재시작 뒤 화면에 올린 손가락이 역할을 못 받아
	# 기체가 안 움직이던 결함). 하지만 이중탭 래치 판정에는 넣지 않는다:
	# "탭해서 재시작 → 곧바로 눌러 드래그" 가 240ms 안이면 집중이 무성으로 켜진다.
	_press_live = SimClock.state == SimClock.State.RUN
	if _press_live and SimClock.wall_tick - _tap_tick <= Tune.TAP_WINDOW_TICKS \
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

## 릴레이 인계 — 설계서 §3 "두 번째 손가락이 이미 덱에 있으면 첫 손가락 릴리스 시
## 드래그 역할을 0프레임으로 넘긴다". 빠져 있던 항목이다.
## 엄지를 옮겨 잡는 동안(p50 180ms) 기체가 완전히 멈추는 것이 재파지의 비용인데,
## 다른 손가락이 이미 화면에 있으면 그 비용을 0 으로 만들 수 있다.
## 오프셋 상대 매핑이라 넘겨받는 손가락의 위치는 도달력 외에 아무 영향이 없다.
func _relay() -> bool:
	if SimClock.state != SimClock.State.RUN or _touch.size() > 2:
		return false
	for idx in _touch:
		var p: Vector2 = _touch[idx]
		if _excluded(p):
			continue
		drag_idx = idx
		drag_pos = p
		_pending_px = Vector2.ZERO
		edge_push = Vector2.ZERO
		_edge_ramp = Vector2.ZERO
		_press_tick = SimClock.wall_tick
		_press_pos = p
		_press_live = true
		relay_count += 1
		return true
	return false

func _on_drag_release(last: Vector2) -> void:
	var held := SimClock.wall_tick - _press_tick
	var moved := _press_pos.distance_to(last if last.x >= 0.0 else _press_pos)
	drag_idx = -1
	edge_push = Vector2.ZERO
	_edge_ramp = Vector2.ZERO
	# 플레이 중에 눌러서 플레이 중에 뗀 것만 탭/재파지로 센다.
	# 사망 화면에서 손을 떼는 것을 재파지로 세면 사망마다 +1 이 되어
	# 지표 ⑤a(≤ 0.1회/분)가 원리적으로 통과 불가능해진다.
	if not _press_live or SimClock.state != SimClock.State.RUN:
		return
	if held <= Tune.TAP_HOLD_MAX_TICKS and moved <= Tune.TAP_MOVE_MAX:
		# 탭이다 — 이중탭 후보로 남긴다. 재파지로 세지 않는다.
		_tap_tick = SimClock.wall_tick
		_tap_pos = _press_pos
	else:
		# 의도치 않은 손 떼기 = 재파지. 이 동안 기체가 완전히 정지한다 (p50 180ms).
		regrip_count += 1
		last_regrip_tick = SimClock.wall_tick
		var fp := last if last.x >= 0.0 else drag_pos
		var rm := Vector4(fp.x * k, (view_size.x - fp.x) * k, fp.y * k, (view_size.y - fp.y) * k)
		regrip_events.append({
			"fx": fp.x, "fy": fp.y, "held": held, "moved": moved,
			"reach_l": rm.x, "reach_r": rm.y, "reach_u": rm.z, "reach_d": rm.w,
			"excl": _excluded(fp),
		})

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

	var d_units := _pending_px * field_per_px
	_pending_px = Vector2.ZERO

	# 엣지 푸시 — 손가락이 밴드 안에 있고 바깥 방향 델타면 그 축에 속도를 더한다.
	# 안쪽 델타 1개로 즉시 해제.
	if drag_idx >= 0:
		_edge_axis(0, drag_pos.x, d_units.x, view_phys.x)
		_edge_axis(1, drag_pos.y, d_units.y, view_phys.y)
	else:
		edge_push = Vector2.ZERO
		_edge_ramp = Vector2.ZERO

	var step := d_units * k + edge_push * Tune.DT
	var mag := step.length()
	if mag > Tune.MAX_STEP_PER_TICK:
		# 초과분을 버리지 않고 다음 틱으로 넘긴다. limit_length 로 버리면 손가락–기체
		# 오프셋이 영구히 어긋난다 — 오프셋 상대 드래그에서 그건 "손가락은 제자리로
		# 돌아왔는데 기체는 아니다" 로 보인다. 특히 max_physics_steps_per_frame=2 로
		# 한 프레임에 2틱이 돌면 그 프레임의 입력 전부가 첫 틱에 몰린다.
		var keep := Tune.MAX_STEP_PER_TICK / mag
		step *= keep
		if field_per_px > 0.0:
			_pending_px += d_units * (1.0 - keep) / field_per_px
	return step

## 세기를 밴드 깊이에 비례시킨다 — 밴드 가장자리 0, 화면 끝 최대.
## 넓은 밴드에 고정 세기를 쓰면 아래로 조금만 끌어도 기체가 튀어 나간다.
func _edge_axis(axis: int, pos: float, delta: float, extent: float) -> void:
	var dir := 0.0
	var reach := 0.0
	if pos <= Tune.EDGE_BAND and delta < 0.0:
		dir = -1.0
		reach = pos * k
	elif pos >= extent - Tune.EDGE_BAND and delta > 0.0:
		dir = 1.0
		reach = (extent - pos) * k
	# 여유가 충분하면 보조하지 않는다 — 밴드는 조대 게이트일 뿐이다.
	if dir != 0.0 and reach >= Tune.EDGE_REACH_FLOOR:
		dir = 0.0
	var cur := _edge_ramp[axis]
	if dir != 0.0:
		var depth := clampf(1.0 - reach / Tune.EDGE_REACH_FLOOR, 0.0, 1.0)
		cur = minf(1.0, cur + 1.0 / float(Tune.EDGE_RAMP_TICKS))
		_edge_ramp[axis] = cur
		edge_push[axis] = dir * Tune.EDGE_PUSH * cur * lerpf(Tune.EDGE_PUSH_MIN, 1.0, depth)
	elif delta != 0.0:
		_edge_ramp[axis] = 0.0                   # 안쪽 델타 1개로 해제
		edge_push[axis] = 0.0
	elif pos > Tune.EDGE_PIN and pos < extent - Tune.EDGE_PIN:
		# 델타 0 = 이 틱에 drag 이벤트가 없었다. 손가락이 화면 물리 끝에 박힌 경우에만
		# 유지한다(거기서는 원래 이벤트가 오지 않는다). 아직 움직일 수 있는 위치에서
		# 멈춘 것은 멈추겠다는 의사이므로 푸시를 끈다 — 안 끄면 기체가 혼자 벽으로 흐른다.
		_edge_ramp[axis] = 0.0
		edge_push[axis] = 0.0

## 화면에 찍을 터치 상태. 프레임당 델타는 표시 후 비운다.
func debug_touches() -> Array:
	var out: Array = []
	for idx in _touch:
		out.append({
			"index": idx,
			"pos": _touch[idx],
			"delta_px": _touch_delta.get(idx, Vector2.ZERO),
			"role": "DRAG" if idx == drag_idx else ("EXCL" if _excluded(_touch[idx]) else "-"),
		})
	out.sort_custom(func(a, b): return a["index"] < b["index"])
	for idx in _touch_delta.keys():
		_touch_delta[idx] = Vector2.ZERO
	return out

## 남은 도달 여유(유닛) — 덱에 상시 표시한다. 축별 [좌, 우, 상, 하].
func reach_margin() -> Vector4:
	if drag_idx < 0:
		return Vector4.ZERO
	var g := k
	return Vector4(
		drag_pos.x * g,
		(view_phys.x - drag_pos.x) * g,
		drag_pos.y * g,
		(view_phys.y - drag_pos.y) * g)

## 런 재시작. 터치 맵과 드래그 역할은 **지우지 않는다** — 화면에 올려 둔 손가락으로
## 곧바로 조작을 이어가야 한다. 대신 사망 화면 동안 쌓인 델타·엣지 푸시·탭 이력만 비운다
## (그대로 두면 재시작 첫 틱에 기체가 사망 화면 동안의 손가락 이동만큼 튄다).
## 구제 성공 직후. 창(30틱 = 500ms) 동안 시뮬이 멈춘 채 쌓인 델타를 버린다 —
## 남기면 부활 첫 틱에 기체가 한꺼번에 튄다(사망 경로는 reset_run 이 이미 막고 있다).
## reset_run 을 부르지 않는 이유: 그것은 k·집중·재파지 계측·릴레이 수까지 되돌리므로
## 구제 성공이 집중 래치와 지표 ⑤ 카운터를 조용히 날린다.
func drop_pending() -> void:
	_pending_px = Vector2.ZERO
	edge_push = Vector2.ZERO
	_edge_ramp = Vector2.ZERO

func reset_run() -> void:
	_pending_px = Vector2.ZERO
	edge_push = Vector2.ZERO
	_edge_ramp = Vector2.ZERO
	_tap_tick = -9999
	bomb_pressed = false
	regrip_events.clear()
	relay_count = 0
	regrip_count = 0
	last_regrip_tick = -9999
	focus_toggles = 0
	focus = false
	k = Tune.K_NORMAL
	_k_from = Tune.K_NORMAL
	_k_to = Tune.K_NORMAL
	_dwell = 0
	_ramp = 0
