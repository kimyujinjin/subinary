class_name FieldOverlay
extends Node2D
## 필드(월드) 공간에 그리는 것 — 기체·적·자탄·판정 오버레이·사망 교재 주석.
##
## Main 이 가로 오프셋(field_dx)을 준 _field 노드 아래에 있다. 덱·HUD 같은 화면 공간 UI 는
## ScreenOverlay 로 분리했다 — 덱은 물리 화면 기준이어야 하기 때문이다.
## 교재의 **탄 자체**는 BulletRenderer 가 리플레이 프레임으로 그린다. 여기는 주석만 그린다.
##
## Control 을 쓰지 않고 Node2D._draw() 로 그린다 — mouse_filter 함정이 원천적으로
## 생기지 않고(Control Button 은 두 번째 손가락으로 절대 안 눌린다) 절차적 도형 방침과도 맞는다.
##
## 판정 원과 스침 링은 집중 모드와 무관하게 상시 표시한다. 수동 판정은 엔진의
## debug collision draw 혜택이 0이므로 판정 코드와 같은 커밋에서 직접 그린다.

var main: Node = null

func _draw() -> void:
	if main == null:
		return
	if SimClock.state == SimClock.State.DEATH_REPLAY or SimClock.state == SimClock.State.DEATH_FROZEN:
		_draw_lesson()
	else:
		_draw_live()

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
# 되감기 → 정지 프레임 → 탭 재시작. 탭은 히트스톱이 끝난 뒤(되감기 중 포함) 받는다 —
# 지표 ③(사망 → 다음 입력 p90 < 1.0s)에 반응 시간 여유를 남기기 위해서다.
#
# 탄은 BulletRenderer 가 같은 텍스처로 그리고, 여기는 그 위에 주석만 얹는다:
# 과거임을 알리는 베일 · 되감기 표식 · 있어야 했던 틈 · 살해탄 링과 궤적 · 기체 · 사망 지점.
func _draw_lesson() -> void:
	var rp: Replay = main.replay
	if rp.length() == 0:
		return
	var step := clampi(int(main.lesson_step), 0, rp.length() - 1)

	# 과거임을 알린다. 이 표식이 없으면 되감기가 "탄이 순간이동했다" 로 읽힌다.
	# 탄 컬링 경계(PF_H + 72)까지 덮는다. PF_H 까지만 덮으면 플레이필드 아래로 나간
	# 교재 탄만 밝게 남아 "과거" 표식이 깨진다.
	draw_rect(Rect2(0.0, 0.0, Tune.PF_W, Tune.PF_H + 80.0), Color(0.01, 0.03, 0.05, 0.38), true)
	if SimClock.state == SimClock.State.DEATH_REPLAY:
		var gc := Color(0.85, 0.95, 0.95, 0.55)
		var gy := Backdrop.BAND_H + 52.0
		for k in 2:
			var gx := Tune.PF_W * 0.5 - 4.0 + float(k) * 18.0
			draw_colored_polygon(PackedVector2Array([
				Vector2(gx - 14.0, gy), Vector2(gx, gy - 10.0), Vector2(gx, gy + 10.0)]), gc)

	# 있어야 했던 틈 — 그 프레임에 플레이어가 속한(또는 가장 가까운) 통로.
	# 밴드에 탄이 없으면 통로가 정의되지 않으므로 그리지 않는다(전폭 720 띠가 켜지던 원인).
	var gap := rp.frame_gap(step)
	var pl := rp.frame_player(step)
	if gap.y > 0:
		var r := Rect2(float(gap.x), pl.y - Tune.BAND_HALF, float(gap.y), Tune.BAND_HALF * 2.0)
		draw_rect(r, Color(Tune.COL_GRID, 0.16), true)
		draw_rect(r, Color(Tune.COL_GRID, 0.55), false, 1.5)

	# 살해탄 링 (현재 프레임) — 탄 자체는 아래 레이어에 이미 그려져 있다.
	var m := rp.frame_count(step)
	for i in m:
		if rp.bullet_bid(step, i) != main.lesson_bid:
			continue
		var kd: int = rp.kinds[rp.base_of(step) + i]
		var rr: float = float(Tune.KIND_VIS_W[kd]) + 8.0
		var bp := rp.bullet_at(step, i)
		draw_arc(bp, rr, 0.0, TAU, 28, Color(1.0, 0.45, 0.45, 0.95), 2.5, true)
		break

	# 살해탄의 0.5초 궤적 — 교재의 핵심이다.
	# 최종 위치만 표시하면 하이라이트가 사망 마커와 겹쳐 아무것도 가르치지 않는다.
	# "어디서 와서 어떻게 휘었는지"가 다음 런에 쓸 수 있는 유일한 정보다.
	var path := PackedVector2Array()
	for st in rp.length():
		var m2 := rp.frame_count(st)
		for j in m2:
			if rp.bullet_bid(st, j) == main.lesson_bid:
				path.append(rp.bullet_at(st, j))
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
