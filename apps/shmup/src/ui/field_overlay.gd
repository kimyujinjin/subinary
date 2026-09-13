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
	_draw_motes()
	_draw_bomb()
	_draw_rescue_ring()
	# 이번 틱에 실제로 판정된 탄의 스윕 캡슐 (판정 오버레이)
	var sc: int = BulletField.swept_count()
	if sc >= 2:
		var seg := PackedVector2Array()
		seg.resize(sc)
		for i in sc:
			seg[i] = BulletField.swept[i]
		draw_multiline(seg, Color(1.0, 0.85, 0.35, 0.20), 1.0)
	_draw_ship(main.player, 1.0)

## 광립 — 청백 코어. 유도 전에는 조류를 타고 부상하므로 동선 자체가 조류 독해 연습이다.
func _draw_motes() -> void:
	var mf: MoteField = main.motes
	if mf.n <= 0:
		return
	var t := SimClock.sim_tick
	for i in mf.n:
		var p := Vector2(mf.xs[i], mf.ys[i])
		var homing := t - mf.born[i] >= Tune.MOTE_HOME_DELAY
		draw_circle(p, Tune.MOTE_R + 3.0, Color(Tune.COL_PSHOT, 0.18))
		draw_circle(p, Tune.MOTE_R, Color(0.86, 0.97, 1.0, 0.95 if homing else 0.7))

## 구제 창 — **기체 위에** 수축하는 링. 눈이 있는 곳에 신호를 둔다.
##
## 실기에서 창 안 입력이 3/3 으로 0건이었다. 그때 신호는 화면 테두리 플래시와
## 우하단 폭탄 원뿐이었는데, 회피 중 시선은 기체에 있으므로 둘 다 주변시다.
## 시선이 있는 자리에서 시간이 줄어드는 것이 보여야 "지금" 이라는 것을 안다.
func _draw_rescue_ring() -> void:
	if SimClock.state != SimClock.State.RESCUE:
		return
	var f := float(SimClock.rescue_left) / float(Tune.RESCUE_TICKS)
	var p: Vector2 = main.lesson_death_pos
	var r := Tune.GRAZE_R + 130.0 * f
	var col := Color(1.0, 0.85, 0.45, 0.35 + 0.5 * (1.0 - f))
	draw_arc(p, r, 0.0, TAU, 48, col, 5.0, true)
	draw_arc(p, Tune.GRAZE_R + 4.0, -PI * 0.5, -PI * 0.5 + TAU * f, 32,
			Color(1.0, 0.85, 0.45, 0.9), 3.0, true)

## 소광침 — 위로 뻗는 기둥 + 주변. 기둥 밖이 남는다는 것이 폭탄의 대가이므로
## 연출도 정확히 그 모양이어야 한다(넓게 번쩍이면 전탄 소거로 오해된다).
func _draw_bomb() -> void:
	var a: int = SimClock.bomb_anim
	if a < 0 or a >= Tune.BOMB_ANIM:
		return
	var f := 1.0 - float(a) / float(Tune.BOMB_ANIM)
	var c: Vector2 = main.bomb_pos
	var w: float = Tune.BOMB_COL_HALF * (0.35 + 0.65 * (1.0 - f))
	draw_rect(Rect2(c.x - w, 0.0, w * 2.0, c.y), Color(0.86, 0.97, 1.0, 0.22 * f))
	draw_line(Vector2(c.x - w, c.y), Vector2(c.x + w, c.y), Color(0.9, 0.98, 1.0, 0.7 * f), 3.0)
	draw_arc(c, Tune.BOMB_LOCAL_R * (1.0 - f * f), 0.0, TAU, 40,
			Color(0.86, 0.97, 1.0, 0.8 * f), 3.0, true)

func _draw_ship(p: Vector2, a: float) -> void:
	# **인물을 그린다.** 이게 없으면 메뉴에만 캐릭터가 있고 5분 동안은 삼각형이 난다 —
	# 캐릭터 게임인데 플레이 중엔 캐릭터가 없는 상태였다.
	# 스프라이트가 없으면 삼각형으로 되돌아간다(그림이 아직 없어도 게임은 돈다).
	if not Sprites.draw_pilot(self, Cast.pilot, p, a):
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
	# 무적 표시 — 부활·폭탄 직후. 있는지 없는지 모르면 언제 다시 위험해지는지 알 수 없다.
	if main.invincible_left > 0 and SimClock.state != SimClock.State.DEATH_REPLAY:
		var w := 1.0 - float(main.invincible_left) / float(Tune.REVIVE_INVINCIBLE)
		draw_arc(p, Tune.GRAZE_R + 6.0, -PI * 0.5, -PI * 0.5 + TAU * clampf(w, 0.0, 1.0), 32,
				Color(0.9, 0.98, 1.0, 0.55 * a), 2.0, true)

## 적 7종 — 절차적 도형. 실루엣이 "무엇을 강요하는 적인가" 를 말해야 한다.
func _draw_enemies() -> void:
	var ef: EnemyField = main.enemies
	for i in ef.n:
		var p := Vector2(ef.px[i], ef.py[i])
		var k: int = ef.etype[i]
		var r: float = EnemyField.R_VIS[k]
		var frac: float = clampf(ef.hp[i] / float(EnemyField.HP[k]), 0.0, 1.0)
		match k:
			EnemyField.Type.DRIFTER:
				draw_circle(p, r, Color(Tune.COL_ENEMY, 0.9))
				draw_arc(p, r + 4.0, -PI * 0.5, -PI * 0.5 + TAU * frac, 24,
						Color(Tune.COL_TIDE, 0.75), 2.5, true)
				draw_circle(p, r * 0.42, Color(Tune.COL_TIDE, 0.55))
			EnemyField.Type.NEEDLEFISH:
				var d := signf(ef.dirx[i])
				draw_colored_polygon(PackedVector2Array([
					p + Vector2(r * d, 0.0),
					p + Vector2(-r * 0.5 * d, -r * 0.55),
					p + Vector2(-r * 0.5 * d, r * 0.55)]),
					Color(Tune.COL_NEEDLE, 0.35 + 0.55 * frac))
			EnemyField.Type.MEDUSA:
				# 종 모양 + 촉수 — "두 번 온다" 를 몸으로 예고한다
				draw_circle(p, r, Color(Tune.COL_ENEMY, 0.85))
				draw_arc(p, r + 5.0, PI, TAU, 20, Color(Tune.COL_BUBBLE, 0.6 * frac + 0.2), 2.5, true)
				for t in 4:
					var tx := p.x - r * 0.6 + r * 0.4 * float(t)
					draw_line(Vector2(tx, p.y + r * 0.3), Vector2(tx, p.y + r * 1.5),
							Color(Tune.COL_BUBBLE, 0.35), 2.0)
			EnemyField.Type.TUBE:
				# 착생 관 — 세로로 길다. 고정 x 라는 것이 실루엣에 있어야 한다
				draw_rect(Rect2(p.x - r * 0.5, p.y - r, r, r * 2.2), Color(Tune.COL_ENEMY, 0.85), true)
				draw_rect(Rect2(p.x - r * 0.5, p.y - r, r, r * 2.2 * frac),
						Color(Tune.COL_GRID, 0.5), true)
			EnemyField.Type.PODWORM:
				# 포낭을 품은 몸통 — 남은 포낭 수가 보인다(DPS 체크의 카운터)
				draw_circle(p, r, Color(Tune.COL_ENEMY, 0.9))
				var pods := int(ceil(float(ef.hold_left[i]) / float(EnemyField.PW_EVERY)))
				for q in mini(pods, 3):
					draw_circle(p + Vector2(-14.0 + 14.0 * float(q), r * 0.1), 5.0,
							Color(Tune.COL_POD, 0.95))
			EnemyField.Type.COLONY_CORE:
				draw_arc(p, r, 0.0, TAU, 28, Color(Tune.COL_ENEMY, 0.8), 3.0, true)
				draw_arc(p, r * 0.55, -PI * 0.5, -PI * 0.5 + TAU * frac, 20,
						Color(Tune.COL_GRID, 0.7), 3.0, true)
			EnemyField.Type.COLONY_BODY:
				draw_circle(p, r, Color(Tune.COL_ENEMY, 0.55 + 0.4 * frac))
				draw_circle(p, r * 0.4, Color(Tune.COL_GRID, 0.5 * frac))
			EnemyField.Type.EEL:
				# 위로 향한 쐐기 — 올라온다는 것이 실루엣에 있다
				draw_colored_polygon(PackedVector2Array([
					p + Vector2(0.0, -r * 1.4), p + Vector2(r * 0.8, r * 0.6),
					p + Vector2(-r * 0.8, r * 0.6)]),
					Color(Tune.COL_BUBBLE, 0.4 + 0.5 * frac))

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
