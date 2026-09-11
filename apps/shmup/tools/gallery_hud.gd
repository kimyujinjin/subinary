class_name GalleryHud
extends Node2D
## 갤러리 오버레이 — 기체·판정 원·패턴 이름·측정값.

var gallery: Node = null
var vh: float = Tune.PF_H

func _draw() -> void:
	if gallery == null:
		return
	var p: Vector2 = gallery.player
	draw_arc(p, Tune.GRAZE_R, 0.0, TAU, 28, Color(Tune.COL_GRID, 0.15), 1.5, true)
	draw_circle(p, Tune.PLAYER_R + 2.0, Color(0.0, 0.0, 0.0, 0.85))
	draw_circle(p, Tune.PLAYER_R, Color(1.0, 1.0, 1.0, 1.0))

	# 밴드 — 공정성 스캔이 보는 구간을 그대로 그린다
	draw_rect(Rect2(0.0, p.y - Tune.BAND_HALF, Tune.PF_W, Tune.BAND_HALF * 2.0),
			Color(Tune.COL_GRID, 0.05), true)
	var g: int = gallery.gap_w()
	if g >= 0:
		draw_rect(Rect2(float(gallery._fair.gap_x0), p.y - Tune.BAND_HALF,
				float(g), Tune.BAND_HALF * 2.0), Color(Tune.COL_GRID, 0.18), true)

	var f := ThemeDB.fallback_font
	var i: int = gallery.idx
	var b: Dictionary = Patterns.BOOK[i]
	# 텍스트는 플레이필드 아래 여백에 둔다 — 탄과 겹치면 둘 다 안 읽힌다.
	var y := Tune.PF_H + 34.0
	if vh < Tune.PF_H + 90.0:
		y = Backdrop.BAND_H + 30.0
	draw_string(f, Vector2(16.0, y), "%d/%d  %s" % [i + 1, Patterns.BOOK.size(), Patterns.NAMES[i]],
			HORIZONTAL_ALIGNMENT_LEFT, -1, 26, Color(0.88, 0.96, 0.96, 0.95))
	draw_string(f, Vector2(16.0, y + 28.0),
			"tier %d   t%d   탄 %d   자유폭 %s%s" % [
				int(b["tier"]), gallery.local, BulletField.n,
				"-" if g < 0 else str(g), "   ⏸" if gallery.paused else ""],
			HORIZONTAL_ALIGNMENT_LEFT, -1, 18, Color(0.75, 0.90, 0.90, 0.8))
	draw_string(f, Vector2(16.0, minf(vh - 18.0, Tune.PF_H + 96.0)),
			"좌/우 탭 = 패턴 전환   상단 탭 = 정지   (← → space r)",
			HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color(0.6, 0.72, 0.75, 0.55))
