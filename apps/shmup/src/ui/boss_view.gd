class_name BossView
extends Node2D
## 화륜종 CORONA — L0 시각. 검은 코어 + draw_arc 링 3개. 셰이더 0줄, 이미지 0개.
## 탄 레이어 아래에 그린다(탄이 몸통 위를 지나간다).
##
## 이 보스의 전부는 정보 구조다. 링이 시계방향으로 돌면 물이 오른쪽으로 흐르고,
## 링이 멈추면 물이 멎는다 — 설명 텍스트 0줄로 게임 전체가 회수된다.
## 페이즈마다 링이 하나씩 더 점등되므로 **점등 수 = 페이즈**가 그대로 보인다.
##
## 색은 유일한 정보원이 아니다: 회전 방향은 눈금의 기울기로도 읽힌다(색각 이상 대비).

const COL_OUTER := Tune.COL_GRID                  # 외륜 청록 — P1 점등
const COL_MID := Color(0.96, 0.72, 0.35)          # 중륜 호박 — P2
const COL_INNER := Color(0.66, 0.52, 0.95)        # 내륜 자색 — P3

var boss: Boss = null
var tick: int = 0

func _draw() -> void:
	if boss == null:
		return
	var c := Vector2(Boss.CX, Boss.CY)
	var ph: int = boss.phase
	var lit := 0.0 if boss.done else 1.0
	var gap := boss.gap_left > 0

	# 내륜 — P3 에서 점등되고 **몸통에서 분리되어** 플레이어 y 선 근처를 공전한다
	var inner_c := c
	if ph >= 3:
		var a3 := boss.ring_angle(tick) * 2.2
		inner_c = Vector2(Boss.CX + cos(a3) * 210.0, 760.0 + sin(a3) * 90.0)
	_ring(inner_c, Boss.R_INNER, COL_INNER, ph >= 3, lit, 48)

	# 중륜 — P2 에서 점등. **외륜과 반대 방향**으로 돈다(역상)
	_ring(c, Boss.R_MID, COL_MID, ph >= 2, lit, 72, -1.0)

	# 외륜 + 발광 기관 24개 — 탄 24발과 1:1
	_ring(c, Boss.R_OUTER, COL_OUTER, true, lit, 96)
	var ang := boss.ring_angle(tick)
	var glow := boss.organ_glow(tick)
	for i in Patterns.P05_COUNT:
		var a := ang + TAU * float(i) / float(Patterns.P05_COUNT)
		var p := c + Vector2(cos(a), sin(a)) * Boss.R_OUTER
		draw_circle(p, 5.0 + 3.0 * glow,
				Color(COL_OUTER, (0.45 + 0.55 * glow) * (0.3 + 0.7 * lit)))

	# 코어 — 배경보다 어두운 실루엣. 전환 중에는 테두리가 밝아진다
	draw_circle(c, Boss.R_CORE + 3.0, Color(COL_OUTER, 0.85 if gap else 0.35))
	draw_circle(c, Boss.R_CORE, Color(0.0, 0.01, 0.02, 1.0))

	# HP 호 + 남은 페이즈 경계 눈금
	var f := boss.hp_frac()
	draw_arc(c, Boss.R_CORE + 12.0, -PI * 0.5, -PI * 0.5 + TAU * f, 64,
			Color(COL_OUTER, 0.85), 4.0, true)
	for frac in [Boss.P1_END_FRAC, Boss.P2_END_FRAC]:
		var ea := -PI * 0.5 + TAU * float(frac)
		var d := Vector2(cos(ea), sin(ea))
		draw_line(c + d * (Boss.R_CORE + 5.0), c + d * (Boss.R_CORE + 19.0),
				Color(1.0, 1.0, 1.0, 0.6), 2.0)

## 점등 여부에 따라 윤곽만 그리거나 밝게 그린다. spin 은 회전 방향(중륜은 반대).
func _ring(c: Vector2, r: float, col: Color, on: bool, lit: float, seg: int,
		spin := 1.0) -> void:
	if not on:
		draw_arc(c, r, 0.0, TAU, seg, Color(col, 0.16), 2.0, true)
		return
	draw_arc(c, r, 0.0, TAU, seg, Color(col, 0.22 + 0.33 * lit), 3.0, true)
	# 회전 방향을 **기울어진 눈금**으로도 보인다 — 색만으로 구분하면 색각 이상에서 무너진다
	var a0 := boss.ring_angle(tick) * spin
	for i in 8:
		var a := a0 + TAU * float(i) / 8.0
		var p0 := c + Vector2(cos(a), sin(a)) * (r - 7.0)
		var p1 := c + Vector2(cos(a + 0.12 * spin), sin(a + 0.12 * spin)) * (r + 7.0)
		draw_line(p0, p1, Color(col, 0.5 * (0.3 + 0.7 * lit)), 2.0)
