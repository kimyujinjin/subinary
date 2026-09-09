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
var tick: int = 0

func _draw() -> void:
	# 배경 그라디언트 — 세로 8분할 사각형. 실기에서 밴딩이 보이면 분할을 늘린다.
	var steps := 8
	for i in steps:
		var f := float(i) / float(steps - 1)
		var c := Tune.COL_ABYSS_TOP.lerp(Tune.COL_ABYSS_BOT, f)
		var y0 := vh * float(i) / float(steps)
		var y1 := vh * float(i + 1) / float(steps)
		draw_rect(Rect2(0.0, y0, Tune.PF_W, y1 - y0 + 1.0), c, true)

	# 플레이필드 하단 경계 — 남는 하단이 손가락 영역임을 시각적으로 못 박는다
	if vh > Tune.PF_H + 1.0:
		draw_rect(Rect2(0.0, Tune.PF_H, Tune.PF_W, vh - Tune.PF_H),
				Color(0.0, 0.0, 0.0, 0.35), true)
		draw_line(Vector2(0.0, Tune.PF_H), Vector2(Tune.PF_W, Tune.PF_H),
				Color(Tune.COL_FLOW, 0.18), 1.0)

	var c_t := BulletField.flow_c(tick)
	_draw_top_band(c_t)
	_draw_side_profile(c_t)

## ① 최상단 12유닛 띠 — 흐름 방향으로 스크롤하는 눈금. 부호와 크기를 동시에 읽힌다.
func _draw_top_band(c_t: float) -> void:
	draw_rect(Rect2(0.0, 0.0, Tune.PF_W, BAND_H), Color(0.0, 0.0, 0.0, 0.5), true)
	var mag := absf(c_t)
	var a := MIN_ALPHA + 0.5 * mag
	var pitch := 40.0
	# 스크롤 위상: 유속에 비례. 정지 창(c=0)에서는 눈금이 멈춘다 = "물이 멎었다"
	var off := fposmod(float(tick) * c_t * 1.35, pitch)
	var x := -pitch + off
	var w := 10.0 + 22.0 * mag
	while x < Tune.PF_W + pitch:
		var x0 := x
		var x1 := x + w * signf(c_t if c_t != 0.0 else 1.0)
		draw_line(Vector2(minf(x0, x1), BAND_H * 0.5), Vector2(maxf(x0, x1), BAND_H * 0.5),
				Color(Tune.COL_FLOW, a), 5.0)
		x += pitch
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
