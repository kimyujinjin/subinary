extends Node
## 받은 그림을 게임에 넣는다 — 마젠타 키잉 + 여백 정리 + 규격 리샘플 + 배치.
##
## Nano Banana(Gemini 2.5 Flash Image)는 **투명 배경을 안 준다.** 그래서 평평한 마젠타로
## 받아 여기서 알파로 바꾼다. 이 단계가 없으면 배경이 심해 화면을 통째로 가린다.
##
## `assets/raw/` 에 규격 파일명으로 두면 된다 — 크기·비율은 아무래도 좋다.
## 여기서 비율을 맞추고(잘라내지 않고 **여백을 붙여서**) 규격 크기로 리샘플한다.
## 잘라내면 받은 그림이 화면에서 다르게 보이고, 그 차이를 그린 사람이 모른다.

const RAW := "res://assets/raw"
## 키로 쓸 색과 허용 반경. 마젠타는 이 게임 팔레트에 없는 색이라 안전하다
## (청록·산호·호박·심청 어디에도 안 겹친다).
const KEY := Color(1.0, 0.0, 1.0)
## 이 값 이상으로 마젠타가 섞였으면 배경으로 본다. 낮추면 반투명부가 더 투명해지고,
## 높이면 배경 가장자리에 자주 실이 남는다. 0.45 는 받은 그림 6장으로 맞춘 값이다.
const KEY_FULL := 0.45

func _ready() -> void:
	var jobs: Array = []
	for i in Portraits.PATHS.size():
		jobs.append([Portraits.PATHS[i], 768, 1024, 20])
	for i in Sprites.PATHS.size():
		jobs.append([Sprites.PATHS[i], 256, 320, 10])
	# 적 — 정사각 256. 길쭉한 종도 비율을 지켜 들어가고(여백이 붙는다),
	# 그리는 쪽이 그 비율을 그대로 쓴다.
	for i in EnemySprites.PATHS.size():
		if EnemySprites.PATHS[i] != "":
			jobs.append([EnemySprites.PATHS[i], 256, 256, 8])
	var done := 0
	print("== 키잉 · 배치 ==")
	for j in jobs:
		var dst: String = j[0]
		var name_: String = dst.get_file()
		var src := "%s/%s" % [RAW, name_]
		if not FileAccess.file_exists(ProjectSettings.globalize_path(src)):
			print("  %-20s (raw 없음 — 건너뜀)" % name_)
			continue
		var img := Image.load_from_file(ProjectSettings.globalize_path(src))
		if img == null:
			print("  %-20s 읽기 실패" % name_)
			continue
		var before := Vector2i(img.get_width(), img.get_height())
		img.convert(Image.FORMAT_RGBA8)
		var keyed := _key(img)
		var trimmed := _trim(img)
		var fitted := _fit(trimmed, int(j[1]), int(j[2]), int(j[3]))
		var err := fitted.save_png(ProjectSettings.globalize_path(dst))
		print("  %-20s %dx%d → 잘라내기 %dx%d → %dx%d · 배경 %d%% · %s" % [
			name_, before.x, before.y, trimmed.get_width(), trimmed.get_height(),
			int(j[1]), int(j[2]), keyed,
			"ok" if err == OK else "err %d" % err])
		done += 1
	print("== %d장 배치 ==" % done)
	if done > 0:
		print("  다음: --import 한 번 → scenes/check_portraits.tscn → scenes/portrait_preview.tscn")
	get_tree().quit(0)

## 마젠타를 알파로 — **디스필(despill) 방식**. 반환은 완전 제거된 화소 비율(%).
##
## 처음엔 "키 색과 거리가 가까우면 지운다" 로 짰는데, 그건 **반투명 부분을 못 지운다.**
## 나린의 모자와 어깨 망토는 반투명이라 마젠타가 그 아래로 비쳐 자주색으로 섞였고,
## 순수 마젠타가 아니라서 살아남아 화면에서 모자에 보라색 격자가 남았다(실측).
##
## 마젠타는 정의상 **R 과 B 가 G 보다 높은** 색이다. 그 초과분 m = min(R,B) − G 가
## 곧 "이 화소에 섞인 마젠타의 양" 이다. 그래서:
##   · m 이 크면 배경 → 알파 0
##   · m 이 중간이면 반투명부에 배경이 비친 것 → 알파를 그만큼 깎고 색에서 자주를 뺀다
##   · m ≤ 0 이면 마젠타가 아니다 → 손대지 않는다
## 이 게임 팔레트가 전부 안전한 이유: 민트(G≥B>R)·심청(B>G>R)·호박(R>G>B) 어디도
## "R 과 B 가 동시에 G 보다 높다" 를 만족하지 않는다.
func _key(img: Image) -> int:
	var w := img.get_width()
	var h := img.get_height()
	var gone := 0
	for y in h:
		for x in w:
			var c := img.get_pixel(x, y)
			var m: float = minf(c.r, c.b) - c.g
			if m <= 0.02:
				continue
			# 알파: 마젠타 초과분이 KEY_FULL 이상이면 완전 투명.
			var a: float = clampf(1.0 - m / KEY_FULL, 0.0, 1.0)
			if a <= 0.004:
				img.set_pixel(x, y, Color(0, 0, 0, 0))
				gone += 1
				continue
			# 디스필: R·B 를 G 까지 끌어내려 자주 기운을 없앤다.
			# 완전히 G 로 눌러 버리면 색이 죽으므로 초과분만 제거한다.
			img.set_pixel(x, y, Color(minf(c.r, c.g), c.g, minf(c.b, c.g), c.a * a))
	return int(round(100.0 * float(gone) / float(w * h)))

## 알파가 있는 영역까지 잘라낸다 — **빈 여백을 버린다.**
##
## 받은 그림에는 빈 배경이 30~60%% 있다. 그걸 그대로 리샘플하면 화면에서 인물이 그만큼
## 작아진다. 실제로 비행 스프라이트(58px)에서 인물이 안 읽히는 뭉개짐이 됐다.
## 잘라내는 것은 **배경뿐**이고 인물은 한 화소도 안 자른다 — 규격의 "잘라내지 않는다" 는
## 인물을 자르지 말라는 뜻이다.
func _trim(img: Image) -> Image:
	var w := img.get_width()
	var h := img.get_height()
	var x0 := w
	var y0 := h
	var x1 := -1
	var y1 := -1
	for y in h:
		for x in w:
			if img.get_pixel(x, y).a > 0.02:
				if x < x0: x0 = x
				if y < y0: y0 = y
				if x > x1: x1 = x
				if y > y1: y1 = y
	if x1 < 0:
		return img
	var out := Image.create(x1 - x0 + 1, y1 - y0 + 1, false, Image.FORMAT_RGBA8)
	out.blit_rect(img, Rect2i(x0, y0, x1 - x0 + 1, y1 - y0 + 1), Vector2i.ZERO)
	return out

## 규격 비율에 **여백을 붙여서** 맞춘다(인물을 잘라내지 않는다). 그 다음 규격 크기로 리샘플.
func _fit(img: Image, tw: int, th: int, margin: int) -> Image:
	var inner_w := tw - margin * 2
	var inner_h := th - margin * 2
	var sc: float = minf(float(inner_w) / float(img.get_width()),
			float(inner_h) / float(img.get_height()))
	var nw: int = maxi(1, int(round(float(img.get_width()) * sc)))
	var nh: int = maxi(1, int(round(float(img.get_height()) * sc)))
	img.resize(nw, nh, Image.INTERPOLATE_LANCZOS)
	var out := Image.create(tw, th, false, Image.FORMAT_RGBA8)
	out.fill(Color(0, 0, 0, 0))
	out.blit_rect(img, Rect2i(0, 0, nw, nh),
			Vector2i((tw - nw) / 2, (th - nh) / 2))
	return out
