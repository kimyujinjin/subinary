extends Node
## 받은 초상화가 규격에 맞는가. **받아서 덮은 뒤 바로 돌리는 검사기다.**
##
## 그림을 그린 사람과 게임이 다른 것을 기대하면 화면에서만 틀어지고, 그때는
## 무엇이 틀렸는지 아무도 모른다. 여기서 숫자로 말한다.

func _ready() -> void:
	var fail := 0
	print("== 초상화 규격 검사 ==")
	print("  파일                     크기        비율   알파  가장자리  판정")
	var all: Array = []
	for x in Portraits.PATHS:
		all.append([x, Portraits.ASPECT, 512])
	for x in Sprites.PATHS:
		all.append([x, Tune.SHIP_SPRITE_ASPECT, 192])
	for entry in all:
		var path: String = entry[0]
		var want_aspect: float = entry[1]
		var min_w: int = entry[2]
		if not ResourceLoader.exists(path):
			print("  %-24s (없음 — 자리표시자로 그려진다)" % path.get_file())
			continue
		var tex := load(path) as Texture2D
		var img := tex.get_image()
		var w := img.get_width()
		var h := img.get_height()
		var ratio := float(w) / float(h)
		var flags := PackedStringArray()
		if absf(ratio - want_aspect) > 0.02:
			flags.append("비율(%.2f 아님)" % want_aspect)
		if w < min_w:
			flags.append("작다(폭 %d 미만)" % min_w)
		if not img.detect_alpha():
			flags.append("알파 없음 — 배경이 화면을 가린다")
			fail += 1
		# 가장자리 20px 이 비어 있는가. 모바일 텍스처 압축이 가장자리를 물어뜯는다.
		var edge_hit := false
		var _unused := min_w
		var m := 20 if want_aspect == Portraits.ASPECT else 10
		for x in range(0, w, maxi(1, w / 64)):
			if img.get_pixel(x, 0).a > 0.02 or img.get_pixel(x, h - 1).a > 0.02:
				edge_hit = true
		for y in range(0, h, maxi(1, h / 64)):
			if img.get_pixel(0, y).a > 0.02 or img.get_pixel(w - 1, y).a > 0.02:
				edge_hit = true
		if edge_hit:
			flags.append("가장자리에 닿음(%dpx 띄울 것)" % m)
		if flags.is_empty():
			flags.append("OK")
		else:
			fail += 1
		print("  %-24s %4dx%-5d %5.3f  %-4s  %-8s %s" % [
			path.get_file(), w, h, ratio, "있음" if img.detect_alpha() else "없음",
			"닿음" if edge_hit else "여백", " ".join(flags)])
	print("\n  규격은 docs/ART_SPEC.md 에 있다.")
	print("== 위반 %d ==" % fail)
	get_tree().quit(1 if fail > 0 else 0)
