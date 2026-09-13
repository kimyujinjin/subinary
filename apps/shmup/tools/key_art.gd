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
const TOL := 0.34
## 가장자리 번짐 정리 — 키 색과 섞인 화소는 알파를 깎는다. 안 하면 인물 테두리에
## 자주색 실이 남고, 어두운 배경 위에서 그게 제일 먼저 보인다.
const FRINGE := 0.55

func _ready() -> void:
	var jobs: Array = []
	for i in Portraits.PATHS.size():
		jobs.append([Portraits.PATHS[i], 768, 1024, 20])
	for i in Sprites.PATHS.size():
		jobs.append([Sprites.PATHS[i], 256, 320, 10])
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
		var fitted := _fit(img, int(j[1]), int(j[2]), int(j[3]))
		var err := fitted.save_png(ProjectSettings.globalize_path(dst))
		print("  %-20s %dx%d → %dx%d · 배경 화소 %d%% 제거 · %s" % [
			name_, before.x, before.y, int(j[1]), int(j[2]), keyed,
			"ok" if err == OK else "err %d" % err])
		done += 1
	print("== %d장 배치 ==" % done)
	if done > 0:
		print("  다음: --import 한 번 → scenes/check_portraits.tscn → scenes/portrait_preview.tscn")
	get_tree().quit(0)

## 마젠타를 알파로. 반환은 제거된 화소 비율(%).
func _key(img: Image) -> int:
	var w := img.get_width()
	var h := img.get_height()
	var hit := 0
	for y in h:
		for x in w:
			var c := img.get_pixel(x, y)
			# 키 색과의 거리. 마젠타는 R 과 B 가 높고 G 가 낮다 —
			# 그 조합이 이 게임 팔레트에 없어서 인물을 안 갉아먹는다.
			var d := absf(c.r - KEY.r) + absf(c.g - KEY.g) + absf(c.b - KEY.b)
			if d < TOL:
				img.set_pixel(x, y, Color(0, 0, 0, 0))
				hit += 1
			elif d < TOL * 2.2:
				# 경계 번짐 — 알파를 깎고 자주색 성분을 빼서 테두리 실을 없앤다
				var t := (d - TOL) / (TOL * 1.2)
				var g := maxf(c.g, 0.0)
				img.set_pixel(x, y, Color(minf(c.r, g + 0.12), c.g, minf(c.b, g + 0.12),
						c.a * clampf(t, 0.0, 1.0) * FRINGE + c.a * (1.0 - FRINGE) * t))
			hit += 0
	return int(round(100.0 * float(hit) / float(w * h)))

## 규격 비율에 **여백을 붙여서** 맞춘다(잘라내지 않는다). 그 다음 규격 크기로 리샘플.
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
