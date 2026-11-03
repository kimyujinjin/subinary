class_name Backdrop
extends Node2D
## 심해 배경 + 조류 3중 표시. 절차적 도형만 — 이미지 애셋 0개.
##
## 조류 표시가 훅의 유일한 교재이므로 시각을 1차 채널로 둔다.
## 원안은 저역 훅 사운드로 조류 반전을 알렸는데, Android 오디오 지연이 80~150ms 이고
## AudioServer.get_output_latency() 가 0 을 반환해 보정도 무효다 —
## 학습이 기기에 따라 흔들리면 안 된다.

const BAND_H := 14.0        # 플레이필드 최상단 — 손가락에 안 가려지는 유일한 위치
const SIDE_W := 8.0
const MIN_ALPHA := 0.35     # 야외 직사광 판정용 하한

var vh: float = Tune.PF_H
var gutter: float = 0.0     ## 좌 거터 폭(유닛). 태블릿에서만 0 이 아니다.
## 우 거터 폭. field_dx 를 floorf 로 깎으므로 좌우가 1유닛 다를 수 있다 —
## 좌 값으로 우를 칠하면 889유닛 뷰포트의 우측 1유닛이 클리어 컬러로 남는다.
var gutter_r: float = 0.0
var tick: int = 0

func _draw() -> void:
	# 배경 그라디언트 — 세로 8분할 사각형. 실기에서 밴딩이 보이면 분할을 늘린다.
	# 필드가 축소되면(태블릿) 좌우·하단에 거터가 생기므로 넉넉히 넘겨 칠한다.
	var steps := 8
	for i in steps:
		var f := float(i) / float(steps - 1)
		var c := Tune.COL_ABYSS_TOP.lerp(Tune.COL_ABYSS_BOT, f)
		var y0 := vh * float(i) / float(steps)
		var y1 := vh * float(i + 1) / float(steps)
		draw_rect(Rect2(-gutter, y0, Tune.PF_W + gutter + gutter_r, y1 - y0 + 1.0), c, true)

	# 플레이필드 하단 경계 — 남는 하단이 손가락 영역임을 시각적으로 못 박는다
	if vh > Tune.PF_H + 1.0:
		draw_rect(Rect2(-gutter, Tune.PF_H, Tune.PF_W + gutter + gutter_r, vh - Tune.PF_H),
				Color(0.0, 0.0, 0.0, 0.35), true)
		draw_line(Vector2(0.0, Tune.PF_H), Vector2(Tune.PF_W, Tune.PF_H),
				Color(Tune.COL_FLOW, 0.18), 1.0)

	# 거터가 있으면 어디까지가 판정 영역인지 보여야 한다
	if gutter > 0.5:
		draw_rect(Rect2(0.0, 0.0, Tune.PF_W, Tune.PF_H), Color(Tune.COL_FLOW, 0.12), false, 1.5)
	var c_t := BulletField.flow_c(tick)
	_draw_top_band(c_t)
	_draw_side_profile(c_t)
	_draw_shear()

## 전단 — 상·하가 반대로 흐르는 구간. **색이 유일한 정보원이면 안 된다**(설계서 §6):
## 경계 난류선 · 배경 유선 갈라짐 · 조류 띠 상하 분할이 같은 값에서 함께 나온다.
func _draw_shear() -> void:
	var sh: float = BulletField.shear
	if sh <= 0.01:
		return
	var y: float = BulletField.shear_y
	# 경계 난류선 — 여기가 안전 통로다
	draw_rect(Rect2(-gutter, y - Tune.SHEAR_TURB_W * 0.5,
			Tune.PF_W + gutter + gutter_r, Tune.SHEAR_TURB_W),
			Color(0.0, 0.01, 0.02, 0.55 * sh), true)
	draw_line(Vector2(0.0, y), Vector2(Tune.PF_W, y), Color(Tune.COL_FLOW, 0.30 * sh), 1.0)
	# 유선 — 위아래가 서로 반대로 갈린다. 화살촉 방향이 곧 그 밴드의 흐름이다
	var rows := 7
	for i in rows:
		var sy := y - Tune.SHEAR_SOFT * 1.6 + Tune.SHEAR_SOFT * 3.2 * float(i) / float(rows - 1)
		var b := clampf((sy - y) / Tune.SHEAR_SOFT, -1.0, 1.0) * BulletField.shear_c
		if absf(b) < 0.15:
			continue
		var w := 26.0 * b
		var a := 0.10 + 0.28 * absf(b) * sh
		var x := fposmod(float(tick) * 2.0 * b, 120.0) - 120.0
		while x < Tune.PF_W + 120.0:
			draw_line(Vector2(x, sy), Vector2(x + w, sy), Color(Tune.COL_FLOW, a), 2.0)
			x += 120.0

## ① 최상단 12유닛 띠 — 흐름 방향으로 스크롤하는 눈금. 부호와 크기를 동시에 읽힌다.
func _draw_top_band(c_t: float) -> void:
	draw_rect(Rect2(0.0, 0.0, Tune.PF_W, BAND_H), Color(0.0, 0.0, 0.0, 0.5), true)
	var mag := absf(c_t)
	var a := MIN_ALPHA + 0.5 * mag
	var pitch := 40.0
	# 스크롤 위상 = 유속의 적분. 정지 창(c=0)에서는 눈금이 멈춘다 = "물이 멎었다".
	# tick × c 로 계산하면 램프마다 역주행한다 — BulletField.flow_phase 주석 참조.
	var off := fposmod(BulletField.flow_phase(tick) * 1.35, pitch)
	var x := -pitch + off
	var w := 10.0 + 22.0 * mag
	while x < Tune.PF_W + pitch:
		var x0 := x
		var x1 := x + w * signf(c_t if c_t != 0.0 else 1.0)
		draw_line(Vector2(minf(x0, x1), BAND_H * 0.5), Vector2(maxf(x0, x1), BAND_H * 0.5),
				Color(Tune.COL_FLOW, a), 5.0)
		x += pitch
	# 전단 중에는 띠 자체가 상하로 갈려 두 방향을 동시에 보인다
	var sh: float = BulletField.shear
	if sh > 0.01:
		draw_rect(Rect2(0.0, 0.0, Tune.PF_W, BAND_H * 0.5), Color(0.0, 0.0, 0.0, 0.6), true)
		for half in 2:
			var dirv := (-1.0 if half == 0 else 1.0) * BulletField.shear_c
			var yy := BAND_H * (0.25 if half == 0 else 0.75)
			var xx := fposmod(float(tick) * 1.35 * dirv, pitch) - pitch
			while xx < Tune.PF_W + pitch:
				draw_line(Vector2(xx, yy), Vector2(xx + 16.0 * dirv, yy),
						Color(Tune.COL_FLOW, 0.35 + 0.5 * sh), 3.0)
				xx += pitch
		return
	# 정지 창은 다른 문법으로 — 점선이 아니라 연속선
	if mag < 0.02:
		draw_line(Vector2(0.0, BAND_H * 0.5), Vector2(Tune.PF_W, BAND_H * 0.5),
				Color(Tune.COL_FLOW, MIN_ALPHA), 2.0)

## ② 좌우 8유닛 — u(y,t) 를 그대로 그린 프로파일. S(y) 가 왜 중앙에서 빠른지 보인다.
func _draw_side_profile(c_t: float) -> void:
	var pts_l := PackedVector2Array()
	var pts_r := PackedVector2Array()
	var rows := 24
	for i in rows + 1:
		var y := Tune.PF_H * float(i) / float(rows)
		var u := c_t * BulletField.flow_s(y)
		pts_l.append(Vector2(SIDE_W * 0.5 + u * SIDE_W * 0.5, y))
		pts_r.append(Vector2(Tune.PF_W - SIDE_W * 0.5 + u * SIDE_W * 0.5, y))
	var col := Color(Tune.COL_FLOW, MIN_ALPHA + 0.35 * absf(c_t))
	draw_polyline(pts_l, col, 2.0)
	draw_polyline(pts_r, col, 2.0)
