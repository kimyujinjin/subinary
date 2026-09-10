class_name BossView
extends Node2D
## 보스 L0 — 검은 원 + draw_arc 링 3개. 셰이더 0줄, 이미지 0개.
## 탄 레이어 아래에 그린다(탄이 몸통 위를 지나간다).
##
## 발광 기관 24개가 외륜 위에서 조류와 같이 돈다. 탄 24발과 1:1 이므로 몸통을 보면
## 다음 발사 각도를 안다(설계서 §6 가독성). 발사 직전 8틱 동안 밝아진다.

const COL_OUTER := Tune.COL_GRID                  # 외륜 청록 — P1 점등
const COL_MID := Color(0.96, 0.72, 0.35)          # 중륜 호박 — P2
const COL_INNER := Color(0.66, 0.52, 0.95)        # 내륜 자색 — P3

var boss: Boss = null
var tick: int = 0

func _draw() -> void:
	if boss == null:
		return
	var c := Vector2(Boss.CX, Boss.CY)
	var lit := 0.0 if boss.done else 1.0

	# 미점등 링 — 윤곽만. P2·P3 에서 켜진다.
	draw_arc(c, Boss.R_INNER, 0.0, TAU, 64, Color(COL_INNER, 0.16), 2.0, true)
	draw_arc(c, Boss.R_MID, 0.0, TAU, 72, Color(COL_MID, 0.16), 2.0, true)

	# 외륜 + 발광 기관
	draw_arc(c, Boss.R_OUTER, 0.0, TAU, 96, Color(COL_OUTER, 0.22 + 0.33 * lit), 3.0, true)
	var ang := boss.ring_angle(tick)
	var glow := boss.organ_glow(tick)
	for i in Patterns.P05_COUNT:
		var a := ang + TAU * float(i) / float(Patterns.P05_COUNT)
		var p := c + Vector2(cos(a), sin(a)) * Boss.R_OUTER
		draw_circle(p, 5.0 + 3.0 * glow,
				Color(COL_OUTER, (0.45 + 0.55 * glow) * (0.3 + 0.7 * lit)))

	# 코어 — 배경보다 어두운 실루엣
	draw_circle(c, Boss.R_CORE + 3.0, Color(COL_OUTER, 0.35))
	draw_circle(c, Boss.R_CORE, Color(0.0, 0.01, 0.02, 1.0))

	# HP — 코어 둘레 호. P1 종료선(70%)을 눈금으로 둔다.
	var f := boss.hp_frac()
	draw_arc(c, Boss.R_CORE + 12.0, -PI * 0.5, -PI * 0.5 + TAU * f, 64,
			Color(COL_OUTER, 0.85), 4.0, true)
	var ea := -PI * 0.5 + TAU * Boss.P1_END_FRAC
	var d := Vector2(cos(ea), sin(ea))
	draw_line(c + d * (Boss.R_CORE + 5.0), c + d * (Boss.R_CORE + 19.0),
			Color(1.0, 1.0, 1.0, 0.6), 2.0)
