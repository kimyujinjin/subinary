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
	_draw_rescue_window()
	_draw_death_feedback()
	_draw_clear_feedback()
	_draw_restart_prompt()
	_draw_deck()
	_draw_bomb_button()
	_draw_gauges()
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

## 구제 창 — 피격 후 폭탄으로 취소할 수 있는 20틱(333ms).
## 테두리 플래시 + 폭탄 히트영역(덱 전역) 강조로 "창이 열렸다" 를 명시한다.
## 창이 열린 줄 모르면 그 기능은 없는 것과 같다.
func _draw_rescue_window() -> void:
	if SimClock.state != SimClock.State.RESCUE:
		return
	var f := float(SimClock.rescue_left) / float(Tune.RESCUE_TICKS)
	var pulse := 0.55 + 0.45 * f
	var edge := 16.0
	var col := Color(1.0, 0.85, 0.45, 0.75 * pulse)
	draw_rect(Rect2(0.0, 0.0, view_w, edge), col, true)
	draw_rect(Rect2(0.0, vh - edge, view_w, edge), col, true)
	draw_rect(Rect2(0.0, 0.0, edge, vh), col, true)
	draw_rect(Rect2(view_w - edge, 0.0, edge, vh), col, true)
	# 덱 전역이 히트영역 — 남은 시간을 폭으로 보인다
	var top := vh - Tune.DECK_H
	draw_rect(Rect2(0.0, top, view_w, Tune.DECK_H), Color(1.0, 0.85, 0.45, 0.16 * pulse), true)
	draw_rect(Rect2(0.0, top, view_w * f, 6.0), Color(1.0, 0.85, 0.45, 0.9), true)

## 폭탄 버튼 — 두 번째 손가락 press. 남은 수만큼 채운 원.
func _draw_bomb_button() -> void:
	var c := Vector2(view_w - Tune.BOMB_CX_FROM_RIGHT, vh - Tune.BOMB_CY_FROM_BOTTOM)
	var n: int = main.bombs
	var live := SimClock.state == SimClock.State.RESCUE
	var a := 0.30 if n > 0 else 0.10
	# 설계서 §3: "폭탄 원 확대로 창이 열린 것을 명시". 밝기만 바꾸면 회피 중에 안 보인다 —
	# 크기 변화는 주변시로도 읽힌다.
	var r := Tune.BOMB_R
	if live:
		a = 0.9
		r *= 1.0 + 0.55 * (float(SimClock.rescue_left) / float(Tune.RESCUE_TICKS))
		draw_arc(c, r + 10.0, 0.0, TAU, 44, Color(1.0, 0.85, 0.45, 0.8), 5.0, true)
	draw_arc(c, r, 0.0, TAU, 40, Color(0.86, 0.97, 1.0, a), 2.5, true)
	for i in Tune.BOMBS:
		var ang := -PI * 0.5 + TAU * float(i) / float(Tune.BOMBS)
		var p := c + Vector2(cos(ang), sin(ang)) * (r * 0.52)
		if i < n:
			draw_circle(p, 9.0, Color(0.86, 0.97, 1.0, 0.75 if not live else 0.95))
		else:
			draw_arc(p, 9.0, 0.0, TAU, 20, Color(0.86, 0.97, 1.0, 0.18), 1.5, true)

## 라이프 · 점수. 텍스트 0줄 방침이라 라이프는 도형, 점수만 숫자다.
func _draw_gauges() -> void:
	var y := vh - Tune.DECK_H + 22.0
	for i in Tune.LIVES:
		var p := Vector2(28.0 + float(i) * 26.0, y)
		if i < main.lives:
			draw_colored_polygon(PackedVector2Array([
				p + Vector2(0.0, -9.0), p + Vector2(7.0, 6.0),
				p + Vector2(0.0, 2.0), p + Vector2(-7.0, 6.0)]),
				Color(Tune.COL_SHIP, 0.9))
		else:
			draw_arc(p, 6.0, 0.0, TAU, 16, Color(Tune.COL_SHIP, 0.2), 1.5, true)
	var f := ThemeDB.fallback_font
	draw_string(f, Vector2(view_w - 190.0, y + 5.0), "%08d" % main.score,
			HORIZONTAL_ALIGNMENT_RIGHT, 170.0, 20, Color(0.86, 0.95, 0.95, 0.85))

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

## 보스 P1 격파 — 청록 플래시 + 코어에서 퍼지는 링. 사망 피드백과 색·방향이 반대다.
func _draw_clear_feedback() -> void:
	var a: int = main.clear_anim
	if a < 0:
		return
	if a < 14:
		var f := 1.0 - float(a) / 14.0
		draw_rect(Rect2(0.0, 0.0, view_w, vh), Color(Tune.COL_GRID, 0.28 * f * f), true)
	if a < 70:
		var t := float(a) / 70.0
		var r := 900.0 * (1.0 - (1.0 - t) * (1.0 - t))
		var c := Vector2(Boss.CX + main.field_dx, Boss.CY)
		draw_arc(c, r, 0.0, TAU, 64, Color(Tune.COL_GRID, (1.0 - t) * 0.8), 5.0, true)

## 재시작 어포던스. 텍스트 0줄 방침이므로 도형으로만 알린다.
##
## 무엇을 해야 하는지 알려주는 것이 없으면 사용자는 "멈췄다/고장났다" 로 읽는다 —
## 실기에서 실제로 그렇게 보고됐다. 사망 지점에 맥동하는 원을 둔다.
func _draw_restart_prompt() -> void:
	# 되감기 시작부터 보인다. 정지 프레임에서만 띄웠더니 "표식이 나올 때까지 기다린다" 를
	# 가르쳐서 실기 재시작 반응이 p50 2.15초(목표 p90 < 1.0초)였다. 입력은 이미 히트스톱
	# 직후부터 받고 있었으므로, 받는 시점과 알리는 시점을 일치시킨다.
	if SimClock.state != SimClock.State.DEATH_REPLAY \
			and SimClock.state != SimClock.State.DEATH_FROZEN:
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
	# 난이도 — 로그와 화면이 같은 문자열을 쓴다. 판정 로그를 나중에 읽을 때
	# "이 숫자가 어느 난이도였나" 를 못 알면 그 로그는 못 쓴다.
	if Difficulty.level != Difficulty.Level.NORMAL:
		l1 += "  %s" % Difficulty.name_of()
	# 5분 타임라인에서는 현재 구역을 띄운다 — 무피격 보너스 단위이자 연습 진입 단위라
	# "지금 몇 구역인가" 를 모르면 실기 판정에서 어느 구역이 문제였는지 적을 수 없다.
	if m.stage_full:
		var z := Stage.zone_of(SimClock.sim_tick)
		l1 += "  Z%d %s" % [z + 1, Stage.ZONE_NAMES[z]]
	# 중간보스 — HP · 페이즈 · 소용돌이 각속도. 소용돌이는 몸통 줄무늬로도 읽히지만
	# 실기 판정에서 "줄무늬가 실제 값과 맞는가" 를 눈으로 대조하려면 숫자가 있어야 한다.
	if m.midboss != null:
		var mb: MidBoss = m.midboss
		var w := mb.vortex_w(SimClock.sim_tick)
		l1 += "  M%.0f%% %s %s" % [mb.hp_frac() * 100.0,
				Cast.MID_PHASE[clampi(mb.phase - 1, 0, 2)],
				"전환" if mb.gap_left > 0 else ("와류%+.1f" % w if w != 0.0 else "조류만")]
	# 보스 HP · 경과 · 현재 페이즈/창 — 요구된 디버그 항목(보스 HP · 현재 패턴 이름)
	if m.boss != null:
		var b: Boss = m.boss
		# 페이즈와 그 안의 리듬 — 요구된 디버그 항목(보스 HP · 현재 패턴 이름)
		var sub := ""
		match b.phase:
			1:
				sub = "압력" if b.window(SimClock.sim_tick).x == 1 else "호흡"
			2:
				var beat := (b.phase_elapsed(SimClock.sim_tick) / Boss.beat_len()) % 4
				sub = ["격자", "포낭", "협곡", "역류"][beat]
				if BulletField.shear > 0.01:
					sub += "·전단%.0f%%" % (BulletField.shear * 100.0)
			_:
				var macro_t := b.phase_elapsed(SimClock.sim_tick) % Boss.MACRO
				sub = "수축" if macro_t < Boss.POCKET_AT \
						else ("주머니" if macro_t < Boss.FINALE_AT else "종조")
		if b.gap_left > 0:
			sub = "전환"
		# 페이즈를 숫자가 아니라 **이름**으로 띄운다. 「점등」·「역상」·「화관」은
		# 그 페이즈가 무엇을 가르치는가와 같은 말이라, 이름이 곧 힌트다.
		l1 += "  B%.0f%% %.1fs %s %s" % [b.hp_frac() * 100.0,
				float(b.phase_elapsed(SimClock.sim_tick)) / 60.0,
				Cast.BOSS_PHASE[clampi(b.phase - 1, 0, 2)], sub]
	var l2 := "k%.2f %s  C%+.2f  gz%d  rg%d  fpp%.3f  %.0fmm%s  %dx%d  run%d  d%d" % [
		TouchRouter.k, "FOCUS" if TouchRouter.focus else "     ",
		BulletField.flow_c(SimClock.sim_tick), BulletField.graze_events,
		TouchRouter.regrip_count, TouchRouter.field_per_px,
		TouchRouter.screen_width_mm(),
		"" if TouchRouter.screen_mm_measured() else "?",
		int(m.view_w), int(vh),
		SimClock.run_index, m.deaths]
	l2 += "  L%d B%d mt%d" % [m.lives, m.bombs, m.motes.n]
	var y := Backdrop.BAND_H + float(fs) + 8.0
	draw_string(f, Vector2(10.0, y), l1, HORIZONTAL_ALIGNMENT_LEFT, -1, fs,
			Color(0.75, 0.90, 0.90, 0.85))
	draw_string(f, Vector2(10.0, y + float(fs) + 3.0), l2, HORIZONTAL_ALIGNMENT_LEFT, -1, fs,
			Color(0.75, 0.90, 0.90, 0.85))
	# 최소 통과 폭 미달 경고. 하한은 **현재 난이도의 것**이어야 한다 — Normal 행으로 고정하면
	# Hard 에서 통과 가능한 틈을 계속 빨갛게 칠하고, Easy 에서는 못 지나는 틈을 안 칠한다.
	# 스캔은 자유 폭 F 를 재므로 D(= F + 32)로 환산해 보인다.
	if m.fairness.in_band > 0 and m.fairness.gap_w < Difficulty.free_floor():
		draw_string(f, Vector2(10.0, y + float(fs) * 2.0 + 6.0),
				"GAP D%d < %d" % [m.fairness.gap_w + int(Tune.SPORE_CLEAR),
						Difficulty.PASS_D[Difficulty.level]],
				HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(1.0, 0.35, 0.35, 0.95))
