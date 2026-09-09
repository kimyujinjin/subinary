class_name Overlay
extends Node2D
## 기체 · 적 · 자탄 · 판정 오버레이 · 디버그 1줄 · 사망 교재.
##
## Control 을 쓰지 않고 Node2D._draw() 로 그린다 — mouse_filter 함정이 원천적으로
## 생기지 않고(Control Button 은 두 번째 손가락으로 절대 안 눌린다) 절차적 도형 방침과도 맞는다.
##
## 판정 원과 스침 링은 집중 모드와 무관하게 상시 표시한다. 수동 판정은 엔진의
## debug collision draw 혜택이 0이므로 판정 코드와 같은 커밋에서 직접 그린다.

var main: Node = null
var vh: float = Tune.PF_H

func _draw() -> void:
	if main == null:
		return
	if SimClock.state == SimClock.State.DEATH_REPLAY or SimClock.state == SimClock.State.DEATH_FROZEN:
		_draw_lesson()
	else:
		_draw_live()
	_draw_deck()
	_draw_hud()

# ── 실시간 ──────────────────────────────────────────────────────────────
func _draw_live() -> void:
	_draw_enemies()
	_draw_pshots()
	# 이번 틱에 실제로 판정된 탄의 스윕 캡슐 (판정 오버레이)
	var sc: int = BulletField.swept_count()
	if sc >= 2:
		var seg := PackedVector2Array()
		seg.resize(sc)
		for i in sc:
			seg[i] = BulletField.swept[i]
		draw_multiline(seg, Color(1.0, 0.85, 0.35, 0.20), 1.0)
	_draw_ship(main.player, 1.0)

func _draw_ship(p: Vector2, a: float) -> void:
	# 관측침 — 절차적 도형. 세로로 긴 삼각 실루엣.
	var v := Tune.SHIP_VIS
	var poly := PackedVector2Array([
		p + Vector2(0.0, -v * 1.5), p + Vector2(v * 0.72, v * 0.85),
		p + Vector2(0.0, v * 0.35), p + Vector2(-v * 0.72, v * 0.85)])
	draw_colored_polygon(poly, Color(Tune.COL_SHIP, 0.90 * a))
	# 스침 링 20유닛 (알파 0.15) — 상시
	draw_arc(p, Tune.GRAZE_R, 0.0, TAU, 28, Color(Tune.COL_GRID, 0.15 * a), 1.5, true)
	# 판정 원 4유닛: 흰 채움 + 2유닛 검은 외곽 — 상시
	draw_circle(p, Tune.PLAYER_R + 2.0, Color(0.0, 0.0, 0.0, 0.85 * a))
	draw_circle(p, Tune.PLAYER_R, Color(1.0, 1.0, 1.0, a))

func _draw_enemies() -> void:
	var ef: EnemyField = main.enemies
	for i in ef.n:
		var p := Vector2(ef.px[i], ef.py[i])
		var k: int = ef.etype[i]
		var r: float = EnemyField.R_VIS[k]
		var frac: float = clampf(ef.hp[i] / float(EnemyField.HP[k]), 0.0, 1.0)
		if k == EnemyField.Type.SPORANGIUM:
			draw_circle(p, r, Color(Tune.COL_ENEMY, 0.9))
			draw_arc(p, r + 4.0, -PI * 0.5, -PI * 0.5 + TAU * frac, 24,
					Color(Tune.COL_TIDE, 0.75), 2.5, true)
			draw_circle(p, r * 0.42, Color(Tune.COL_TIDE, 0.55))
		else:
			var poly := PackedVector2Array([
				p + Vector2(r * signf(ef.dirx[i]), 0.0),
				p + Vector2(-r * 0.5 * signf(ef.dirx[i]), -r * 0.55),
				p + Vector2(-r * 0.5 * signf(ef.dirx[i]), r * 0.55)])
			draw_colored_polygon(poly, Color(Tune.COL_NEEDLE, 0.35 + 0.55 * frac))

func _draw_pshots() -> void:
	var m := main
	if m.shot_n <= 0:
		return
	var seg := PackedVector2Array()
	seg.resize(m.shot_n * 2)
	for i in m.shot_n:
		seg[i * 2] = Vector2(m.shot_x[i], m.shot_y[i])
		seg[i * 2 + 1] = Vector2(m.shot_x[i], m.shot_y[i] + 22.0)
	draw_multiline(seg, Color(Tune.COL_PSHOT, 0.75), 2.5)

# ── 사망 교재 ───────────────────────────────────────────────────────────
# 0.5초 되감기 → 정지 프레임 → 탭 재시작. 전체 1.0초 미만이고,
# 탭은 되감기 중에도 즉시 받는다 (지표 ③ 사망 → 다음 입력 p90 < 1.0s).
func _draw_lesson() -> void:
	var rp: Replay = main.replay
	var step: int = main.lesson_step
	if rp.length() == 0:
		return
	step = clampi(step, 0, rp.length() - 1)
	var cols := [Tune.COL_TIDE, Tune.COL_GRID, Tune.COL_NEEDLE]

	# 있어야 했던 틈 — 1D 스캔의 최장 자유 구간을 그대로 띠로 그린다
	var gap := rp.frame_gap(step)
	var pl := rp.frame_player(step)
	if gap.y > 0:
		draw_rect(Rect2(float(gap.x), pl.y - Tune.BAND_HALF, float(gap.y), Tune.BAND_HALF * 2.0),
				Color(Tune.COL_GRID, 0.16), true)
		draw_rect(Rect2(float(gap.x), pl.y - Tune.BAND_HALF, float(gap.y), Tune.BAND_HALF * 2.0),
				Color(Tune.COL_GRID, 0.55), false, 1.5)

	var m := rp.frame_count(step)
	for i in m:
		var b := rp.bullet_at(step, i)
		var kd := int(b.z)
		var p := Vector2(b.x, b.y)
		var killer: bool = rp.bullet_bid(step, i) == main.lesson_bid
		var c: Color = cols[kd]
		var r: float = float(Tune.KIND_W[kd])
		if killer:
			draw_circle(p, r + 7.0, Color(1.0, 0.30, 0.35, 0.35))
			draw_arc(p, r + 7.0, 0.0, TAU, 24, Color(1.0, 0.45, 0.45, 0.95), 2.0, true)
		draw_circle(p, r, Color(c, 0.85 if killer else 0.5))

	# 살해탄의 0.5초 궤적 — 교재의 핵심이다.
	# 최종 위치만 표시하면 하이라이트가 사망 마커와 겹쳐 아무것도 가르치지 않는다.
	# "어디서 와서 어떻게 휘었는지"가 다음 런에 쓸 수 있는 유일한 정보다.
	var path := PackedVector2Array()
	for st in rp.length():
		var m2 := rp.frame_count(st)
		for j in m2:
			if rp.bullet_bid(st, j) == main.lesson_bid:
				var bb := rp.bullet_at(st, j)
				path.append(Vector2(bb.x, bb.y))
				break
	if path.size() >= 2:
		draw_polyline(path, Color(1.0, 0.42, 0.45, 0.30), 9.0)
		draw_polyline(path, Color(1.0, 0.75, 0.72, 0.95), 2.5)
		draw_circle(path[0], 5.0, Color(1.0, 0.75, 0.72, 0.95))

	_draw_ship(pl, 0.75)
	# 사망 지점
	var dp: Vector2 = main.lesson_death_pos
	draw_arc(dp, 14.0, 0.0, TAU, 24, Color(1.0, 0.35, 0.40, 0.9), 2.0, true)
	draw_line(dp + Vector2(-20.0, 0.0), dp + Vector2(20.0, 0.0), Color(1.0, 0.35, 0.40, 0.7), 1.5)
	draw_line(dp + Vector2(0.0, -20.0), dp + Vector2(0.0, 20.0), Color(1.0, 0.35, 0.40, 0.7), 1.5)

# ── 컨트롤 덱 ───────────────────────────────────────────────────────────
# 뷰포트 절대 하단 240유닛. 16:9 기기에서는 여백이 0이라 덱이 플레이필드를 덮는다 —
# 그 최악 케이스를 눈으로 확인할 수 있게 경계를 항상 그린다.
func _draw_deck() -> void:
	var top := vh - Tune.DECK_H
	draw_line(Vector2(0.0, top), Vector2(Tune.PF_W, top), Color(Tune.COL_FLOW, 0.12), 1.0)
	# 역할 배정 제외 영역
	draw_rect(Rect2(0.0, top, Tune.EXCL_SIDE, Tune.DECK_H), Color(1.0, 0.3, 0.3, 0.05), true)
	draw_rect(Rect2(Tune.PF_W - Tune.EXCL_SIDE, top, Tune.EXCL_SIDE, Tune.DECK_H),
			Color(1.0, 0.3, 0.3, 0.05), true)
	draw_rect(Rect2(0.0, vh - Tune.EXCL_BOTTOM, Tune.PF_W, Tune.EXCL_BOTTOM),
			Color(1.0, 0.3, 0.3, 0.05), true)

	# 도달 여유 인디케이터 — 손가락이 어느 방향으로 얼마나 남았는지 상시 표시.
	# 이것이 없으면 도달력 소진이 무성으로 발생한다.
	if TouchRouter.drag_idx >= 0:
		var rm := TouchRouter.reach_margin()
		var cx := Tune.PF_W * 0.5
		var cy := vh - Tune.DECK_H * 0.5
		var s := 0.16
		var col := Color(Tune.COL_GRID, 0.55)
		var warn := Color(1.0, 0.45, 0.35, 0.85)
		var lim := 120.0
		draw_line(Vector2(cx, cy), Vector2(cx - rm.x * s, cy), warn if rm.x < lim else col, 3.0)
		draw_line(Vector2(cx, cy), Vector2(cx + rm.y * s, cy), warn if rm.y < lim else col, 3.0)
		draw_line(Vector2(cx, cy), Vector2(cx, cy - rm.z * s), warn if rm.z < lim else col, 3.0)
		draw_line(Vector2(cx, cy), Vector2(cx, cy + rm.w * s), warn if rm.w < lim else col, 3.0)
		draw_circle(Vector2(cx, cy), 4.0, col)
		# 손가락 위치와 엣지 푸시 상태
		draw_arc(TouchRouter.drag_pos, 26.0, 0.0, TAU, 20,
				Color(1.0, 1.0, 1.0, 0.18 if TouchRouter.edge_push == Vector2.ZERO else 0.55), 2.0, true)

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
	var l2 := "k%.2f %s  C%+.2f  gz%d  rg%d  ppu%.3f  %.0fmm  vh%d  run%d  d%d" % [
		TouchRouter.k, "FOCUS" if TouchRouter.focus else "     ",
		BulletField.flow_c(SimClock.sim_tick), BulletField.graze_events,
		TouchRouter.regrip_count, TouchRouter.units_per_px,
		TouchRouter.screen_width_mm(), int(vh), SimClock.run_index, m.deaths]
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
