class_name ScreenOverlay
extends Node2D
## 뷰포트(화면) 공간에 그리는 것 — 컨트롤 덱·도달 여유 인디케이터·터치 디버그·HUD 1줄.
##
## 필드가 태블릿에서 축소되어도 덱과 손가락 영역은 물리 화면 기준이어야 하므로
## 스케일 밖에 둔다. 덱은 뷰포트 절대 하단 240유닛이지 플레이필드 기준이 아니다.

var main: Node = null
var vh: float = Tune.PF_H
var view_w: float = Tune.PF_W

func _draw() -> void:
	if main == null:
		return
	_draw_gutter_mask()
	_draw_death_feedback()
	_draw_restart_prompt()
	_draw_deck()
	_draw_touch_debug()
	_draw_hud()

## 태블릿 거터 가림막. _field 에는 클립이 없어서 플레이필드 밖으로 나간 탄·잔광이
## 거터에 그대로 보이고 눈앞에서 사라진다. 필드 레이어 위(이 레이어)에서 가린다.
func _draw_gutter_mask() -> void:
	var dx: float = main.field_dx
	if dx <= 0.5:
		return
	var c := Tune.COL_ABYSS_BOT
	draw_rect(Rect2(0.0, 0.0, dx, vh), c, true)
	var rx: float = dx + Tune.PF_W
	draw_rect(Rect2(rx, 0.0, view_w - rx, vh), c, true)

# ── 컨트롤 덱 ───────────────────────────────────────────────────────────
# 뷰포트 절대 하단 240유닛. 16:9 기기에서는 여백이 0이라 덱이 플레이필드를 덮는다 —
# 그 최악 케이스를 눈으로 확인할 수 있게 경계를 항상 그린다.
func _draw_deck() -> void:
	var top := vh - Tune.DECK_H
	draw_line(Vector2(0.0, top), Vector2(view_w, top), Color(Tune.COL_FLOW, 0.12), 1.0)
	# 역할 배정 제외 영역
	draw_rect(Rect2(0.0, top, Tune.EXCL_SIDE, Tune.DECK_H), Color(1.0, 0.3, 0.3, 0.05), true)
	draw_rect(Rect2(view_w - Tune.EXCL_SIDE, top, Tune.EXCL_SIDE, Tune.DECK_H),
			Color(1.0, 0.3, 0.3, 0.05), true)
	draw_rect(Rect2(0.0, vh - Tune.EXCL_BOTTOM, view_w, Tune.EXCL_BOTTOM),
			Color(1.0, 0.3, 0.3, 0.05), true)

	# 도달 여유 인디케이터 — 손가락이 어느 방향으로 얼마나 남았는지 상시 표시.
	# 이것이 없으면 도달력 소진이 무성으로 발생한다.
	if TouchRouter.drag_idx >= 0:
		var rm := TouchRouter.reach_margin()
		var cx := view_w * 0.5
		var cy := vh - Tune.DECK_H * 0.5
		var s := 0.16
		var col := Color(Tune.COL_GRID, 0.55)
		var warn := Color(1.0, 0.45, 0.35, 0.85)
		var lim := 120.0
		# 막대 길이를 덱 반높이 안으로 자른다. 상방 여유는 손가락 y(≈1400) 전체라
		# 그대로 그리면 269유닛짜리 막대가 덱을 넘어 플레이필드 안으로 뻗었다.
		var cap := Tune.DECK_H * 0.5 - 12.0
		draw_line(Vector2(cx, cy), Vector2(cx - minf(rm.x * s, cap), cy), warn if rm.x < lim else col, 3.0)
		draw_line(Vector2(cx, cy), Vector2(cx + minf(rm.y * s, cap), cy), warn if rm.y < lim else col, 3.0)
		draw_line(Vector2(cx, cy), Vector2(cx, cy - minf(rm.z * s, cap)), warn if rm.z < lim else col, 3.0)
		draw_line(Vector2(cx, cy), Vector2(cx, cy + minf(rm.w * s, cap)), warn if rm.w < lim else col, 3.0)
		draw_circle(Vector2(cx, cy), 4.0, col)
		# 손가락 위치와 엣지 푸시 상태
		draw_arc(TouchRouter.drag_pos, 26.0, 0.0, TAU, 20,
				Color(1.0, 1.0, 1.0, 0.18 if TouchRouter.edge_push == Vector2.ZERO else 0.55), 2.0, true)

## 사망 피드백 — 화면 전체 플래시 + 사망 지점에서 확장하는 링 파동.
##
## 설계서: "피격·폭탄 피드백의 1순위는 소리가 아니라 화면(히트스톱 + 플래시 + 링 파동)".
## Android 오디오 지연이 80~150ms 이고 AudioServer.get_output_latency() 가 0 을 돌려주므로
## 보정도 무효다 — 그래서 사망 신호는 전부 시각이어야 한다.
##
## 히트스톱만 구현했더니 실기에서 죽는 순간이 "화면이 갑자기 되감기며 멈춘다" 로만
## 보였고, 사용자가 크래시로 인식했다.
const FLASH_TICKS := 7
const RING_TICKS := 26
const RING_MAX := 260.0

func _draw_death_feedback() -> void:
	var a: int = SimClock.death_anim
	if a < 0:
		return
	if a < FLASH_TICKS:
		var f := 1.0 - float(a) / float(FLASH_TICKS)
		draw_rect(Rect2(0.0, 0.0, view_w, vh), Color(1.0, 0.45, 0.48, 0.34 * f * f), true)
	if a < RING_TICKS:
		var t := float(a) / float(RING_TICKS)
		var r := RING_MAX * (1.0 - (1.0 - t) * (1.0 - t))   # ease-out
		var alpha := (1.0 - t) * 0.85
		var c := Vector2(main.lesson_death_pos.x + main.field_dx, main.lesson_death_pos.y)
		draw_arc(c, r, 0.0, TAU, 48, Color(1.0, 0.42, 0.45, alpha), 4.0, true)
		draw_arc(c, r * 0.72, 0.0, TAU, 48, Color(1.0, 0.75, 0.72, alpha * 0.5), 2.0, true)

## 재시작 어포던스. 텍스트 0줄 방침이므로 도형으로만 알린다.
##
## 정지 프레임에서 무엇을 해야 하는지 알려주는 것이 없으면 사용자는 "멈췄다/고장났다"로
## 읽는다 — 실기에서 실제로 그렇게 보고됐다. 사망 지점에 맥동하는 원을 둔다.
func _draw_restart_prompt() -> void:
	if SimClock.state != SimClock.State.DEATH_FROZEN:
		return
	var t := float(SimClock.death_anim) / 60.0
	var pulse := 0.5 + 0.5 * sin(t * TAU * 0.9)
	var c := Vector2(main.lesson_death_pos.x + main.field_dx, main.lesson_death_pos.y)
	var r := 30.0 + 10.0 * pulse
	draw_arc(c, r, 0.0, TAU, 40, Color(0.95, 0.98, 0.98, 0.25 + 0.5 * pulse), 2.5, true)
	# 손가락 모양 대신 안쪽으로 향하는 삼각 4개 — "여기를 눌러라"
	for i in 4:
		var a := float(i) * TAU * 0.25 + PI * 0.25
		var d := Vector2(cos(a), sin(a))
		var n := Vector2(-d.y, d.x)
		var tip := c + d * (r - 9.0)
		var base := c + d * (r + 7.0)
		draw_colored_polygon(PackedVector2Array([tip, base + n * 6.0, base - n * 6.0]),
				Color(0.95, 0.98, 0.98, 0.2 + 0.45 * pulse))

## 터치 디버그 — P1 의 게이트 항목이다. "실기에서 두 손가락 index 가 각각 보이는가."
##
## 맥에서는 원리적으로 확인할 수 없다: 합성 터치는 index 0 하나뿐이고
## device = DEVICE_ID_EMULATION 이다. 그래서 이 표시는 실기 전용 검증 도구이며
## 릴리스 빌드에서도 살려 둔다 — 판정은 릴리스 빌드에서만 유효하다.
func _draw_touch_debug() -> void:
	var f := ThemeDB.fallback_font
	var list: Array = TouchRouter.debug_touches()
	var y := vh - Tune.DECK_H + 18.0
	for e in list:
		var idx: int = e["index"]
		var pos: Vector2 = e["pos"]
		var d: Vector2 = e["delta_px"]
		var role: String = e["role"]
		var col := Color(0.55, 0.95, 0.9, 0.9) if role == "DRAG" else Color(0.95, 0.6, 0.4, 0.8)
		draw_arc(pos, 34.0, 0.0, TAU, 24, col, 2.0, true)
		draw_line(pos, pos + d * 3.0, col, 2.0)
		draw_string(f, pos + Vector2(38.0, 5.0), "#%d %s" % [idx, role],
				HORIZONTAL_ALIGNMENT_LEFT, -1, 15, col)
		draw_string(f, Vector2(14.0, y),
				"#%d %s (%4.0f,%4.0f) d(%+5.1f,%+5.1f)px" % [idx, role, pos.x, pos.y, d.x, d.y],
				HORIZONTAL_ALIGNMENT_LEFT, -1, 14, col)
		y += 17.0
	if list.is_empty():
		draw_string(f, Vector2(14.0, y), "터치 0 — 실기에서 두 손가락이 각각 #0 #1 로 보여야 한다",
				HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color(0.6, 0.7, 0.75, 0.6))

# ── 디버그 1줄 ──────────────────────────────────────────────────────────
# 릴리스 빌드에서도 살려 둔다 — 개발자가 유일한 테스터이고 판정은 릴리스에서만 유효하다.
func _draw_hud() -> void:
	var f := ThemeDB.fallback_font
	var fs := 15
	var m := main
	var l1 := "t%d  b%d/%d  fps%d  proc%.2f  phys%.2f  dc%d  gap%d" % [
		SimClock.sim_tick, BulletField.n, BulletField.peak_n,
		int(Engine.get_frames_per_second()),
		Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0,
		Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0,
		int(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)),
		m.fairness.gap_w]
	var l2 := "k%.2f %s  C%+.2f  gz%d  rg%d  fpp%.3f  %.0fmm%s  %dx%d  run%d  d%d" % [
		TouchRouter.k, "FOCUS" if TouchRouter.focus else "     ",
		BulletField.flow_c(SimClock.sim_tick), BulletField.graze_events,
		TouchRouter.regrip_count, TouchRouter.field_per_px,
		TouchRouter.screen_width_mm(),
		"" if TouchRouter.screen_mm_measured() else "?",
		int(m.view_w), int(vh),
		SimClock.run_index, m.deaths]
	var y := Backdrop.BAND_H + float(fs) + 8.0
	draw_string(f, Vector2(10.0, y), l1, HORIZONTAL_ALIGNMENT_LEFT, -1, fs,
			Color(0.75, 0.90, 0.90, 0.85))
	draw_string(f, Vector2(10.0, y + float(fs) + 3.0), l2, HORIZONTAL_ALIGNMENT_LEFT, -1, fs,
			Color(0.75, 0.90, 0.90, 0.85))
	# 최소 통과 폭 위반 경고 — MIN_GAP_UNITS 하드 하한
	if m.fairness.gap_w < Tune.MIN_GAP_UNITS and BulletField.n > 0:
		draw_string(f, Vector2(10.0, y + float(fs) * 2.0 + 6.0),
				"GAP %d < MIN %d" % [m.fairness.gap_w, Tune.MIN_GAP_UNITS],
				HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(1.0, 0.35, 0.35, 0.95))
