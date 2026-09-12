class_name MidBossView
extends Node2D
## 중간보스 L0 — 방추형 몸통 윤곽 + 발광 줄무늬. 셰이더 0줄, 텍스처 0개.
##
## 줄무늬는 `MidBoss.spin_angle()` 하나로 흐른다. 그 함수는 소용돌이 각속도에서 나오므로
## **화면의 줄무늬 방향 = 실제 물의 회전 방향**이다. 둘을 따로 계산하면
## "물의 상태가 적의 몸에 그려져 있다" 가 거짓말이 되고, 플레이어는 몸을 못 믿게 된다.
##
## 색은 유일한 정보원이 아니다: 페이즈는 줄무늬 **개수**(3 → 5 → 7)로도 읽히고,
## P3 의 반전은 줄무늬가 멈췄다 반대로 흐르는 것으로 읽힌다.

const SEGS := 22                  ## 윤곽 표본 수 — 한쪽 면
const STRIPES := [3, 5, 7]
const COL_BODY := Color(0.10, 0.16, 0.20, 1.0)
const COL_EDGE := Color(0.42, 0.86, 0.80, 0.85)
const COL_STRIPE := Color(0.55, 0.95, 0.88, 0.9)
const COL_P3 := Color(0.95, 0.72, 0.45, 0.9)

var mb: MidBoss = null
var tick: int = 0

## 방추형 반폭. u ∈ [-1, 1] 에서 끝이 0 이고 중앙이 최대다.
static func half_w(u: float) -> float:
	var q := 1.0 - u * u
	return MidBoss.HALF_W * pow(maxf(q, 0.0), 0.62)

func _draw() -> void:
	if mb == null or mb.done:
		return
	var c := Vector2(MidBoss.CX, MidBoss.CY)
	var pts := PackedVector2Array()
	# 오른쪽 면 위→아래, 왼쪽 면 아래→위. 닫힌 다각형 하나로 그린다.
	for i in SEGS + 1:
		var u := -1.0 + 2.0 * float(i) / float(SEGS)
		pts.append(c + Vector2(half_w(u), u * MidBoss.HALF_H))
	for i in SEGS + 1:
		var u := 1.0 - 2.0 * float(i) / float(SEGS)
		pts.append(c + Vector2(-half_w(u), u * MidBoss.HALF_H))
	draw_colored_polygon(pts, COL_BODY)
	draw_polyline(pts, COL_EDGE, 2.0, true)
	draw_line(pts[pts.size() - 1], pts[0], COL_EDGE, 2.0, true)

	# 남은 HP 를 몸통 아래에서 차오르는 밝은 테두리로 — 숫자 없이 읽힌다.
	var f := mb.hp_frac()
	if f > 0.0:
		var y0 := c.y + MidBoss.HALF_H
		var y1 := y0 - 2.0 * MidBoss.HALF_H * f
		draw_line(Vector2(c.x, y0), Vector2(c.x, y1), COL_EDGE * Color(1, 1, 1, 0.45), 3.0, true)

	var ang := mb.spin_angle(tick)
	var n: int = STRIPES[clampi(mb.phase - 1, 0, 2)]
	var col := COL_P3 if mb.phase >= 3 else COL_STRIPE
	if mb.gap_left > 0:
		col = col.lerp(Color(1, 1, 1, 1), 0.5)
	for k in n:
		# 줄무늬 하나 = 몸통을 가로지르는 곡선. x 는 자전각으로 흔들리고,
		# 몸통 밖으로 나가지 않도록 그 y 의 반폭으로 클램프된다.
		var phase_k := TAU * float(k) / float(n)
		var seg := PackedVector2Array()
		for i in SEGS + 1:
			var u := -1.0 + 2.0 * float(i) / float(SEGS)
			var w := half_w(u)
			seg.append(c + Vector2(w * sin(ang + phase_k + u * 2.4), u * MidBoss.HALF_H))
		draw_polyline(seg, col, 1.6, true)
