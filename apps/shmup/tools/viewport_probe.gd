extends Node
## stretch = canvas_items + expand 가 실제로 어느 축을 늘리는지 실측한다.
## 설계서는 "폭은 모든 폰에서 정확히 720유닛, 높이만 변한다"고 적었는데
## 그것이 모든 종횡비에서 참인지 확인한 적이 없다.
func _ready() -> void:
	await get_tree().process_frame
	var win := DisplayServer.window_get_size()
	var vis := get_viewport().get_visible_rect().size
	print("창 %dx%d  →  가시영역 %.1f x %.1f   (기준 720x1280)" % [win.x, win.y, vis.x, vis.y])
	print("  폭 초과 %.1f · 높이 초과 %.1f · field_per_px = %.4f" % [
		vis.x - 720.0, vis.y - 1280.0, vis.x / float(win.x)])
	get_tree().quit(0)
