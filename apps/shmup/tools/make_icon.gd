extends Node
## 앱 아이콘을 코드에서 굽는다.
##
## iOS 는 앱 아이콘이 필수라 여기가 "이미지 애셋 0개" 확정사항의 첫 예외 지점이다.
## 손으로 그린 파일을 두는 대신 탄과 같은 셰이딩 문법(코어 + 림 + 헤일로)으로 생성해
## 예외를 "생성물"로 유지한다 — 라이선스 표면 0, 저장소에 바이너리 1개.
##
## 재생성: godot --headless --path . scenes/make_icon.tscn

const SIZE := 1024

func _ready() -> void:
	var img := Image.create_empty(SIZE, SIZE, false, Image.FORMAT_RGBA8)
	var c := float(SIZE) * 0.5
	for y in SIZE:
		for x in SIZE:
			var ux := (float(x) + 0.5 - c) / c
			var uy := (float(y) + 0.5 - c) / c
			img.set_pixel(x, y, _shade(ux, uy))
	var err := img.save_png("res://icon.png")
	print("icon.png -> %s (%dx%d)" % ["ok" if err == OK else "fail", SIZE, SIZE])
	get_tree().quit(0 if err == OK else 1)

func _shade(ux: float, uy: float) -> Color:
	# 배경: 심해 그라디언트 (아이콘은 불투명해야 한다 — iOS 는 알파를 허용하지 않는다)
	var bg := Tune.COL_ABYSS_TOP.lerp(Tune.COL_ABYSS_BOT, (uy + 1.0) * 0.5)
	var col := Color(bg.r, bg.g, bg.b, 1.0)

	# 조류에 실려 기운 포자 3개 — 게임의 유일한 어휘를 그대로 쓴다
	var spores := [
		[-0.34, -0.30, 0.20, Tune.COL_TIDE],
		[ 0.06,  0.02, 0.26, Tune.COL_GRID],
		[ 0.40,  0.34, 0.16, Tune.COL_TIDE],
	]
	for s in spores:
		var dx: float = ux - float(s[0])
		var dy: float = uy - float(s[1])
		var r: float = float(s[2])
		var sc: Color = s[3]
		var d := sqrt(dx * dx + dy * dy) - r
		var rim := r * 0.20
		if d < -rim:
			col = sc
		elif d < 0.0:
			var t := smoothstep(-rim, 0.0, d)
			col = sc.lerp(Color(0.02, 0.03, 0.04), t)
		elif d < r * 0.75:
			var f := 1.0 - d / (r * 0.75)
			f = f * f * 0.55
			col = Color(col.r + sc.r * f, col.g + sc.g * f, col.b + sc.b * f, 1.0)

	# 조류 방향을 나타내는 사선 잔광.
	# iOS 는 아이콘을 라운드 마스킹하므로 모서리를 피해 비어 있는 좌하단으로 지나가게 둔다.
	var band := absf(uy - ux * 0.42 - 0.58)
	if band < 0.026:
		var a := (1.0 - band / 0.026) * 0.6
		col = Color(col.r + Tune.COL_GRID.r * a, col.g + Tune.COL_GRID.g * a,
				col.b + Tune.COL_GRID.b * a, 1.0)
	return Color(clampf(col.r, 0.0, 1.0), clampf(col.g, 0.0, 1.0), clampf(col.b, 0.0, 1.0), 1.0)
