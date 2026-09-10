extends Node
## 프로젝트 설정 키 존재 대조. 키 이름이 틀리면 Godot 은 조용히 무시하므로
## "설정했다고 생각한 값이 실제로는 기본값"인 상태를 이 스크립트만이 잡아낸다.

const EXPECT := {
	"application/run/max_fps": 60,
	"application/config/quit_on_go_back": false,
	"display/window/size/viewport_width": 720,
	"display/window/size/viewport_height": 1280,
	"display/window/stretch/mode": "canvas_items",
	"display/window/stretch/aspect": "expand",
	# int enum 이다. 기대값을 문자열로 적어 두면 이 검사가 통과해 버리고,
	# 실기에서 조용히 가로로 뜬다 — 실제로 그렇게 놓쳤다.
	"display/window/handheld/orientation": 1,
	"input_devices/buffering/agile_event_flushing": true,
	"physics/common/max_physics_steps_per_frame": 2,
	"physics/common/physics_interpolation": false,
	"physics/common/enable_object_picking": false,
	"rendering/renderer/rendering_method": "mobile",
	"rendering/renderer/rendering_method.mobile": "mobile",
	"rendering/viewport/hdr_2d": false,
	"display/window/frame_pacing/android/swappy_mode": 0,
	# iOS/Android export 의 필수 조건. 꺼져 있으면 export 가 메시지 없이 실패한다.
	"rendering/textures/vram_compression/import_etc2_astc": true,
}
## 존재만 확인 — 값은 실기 판정 후 정한다
const EXIST := [
	"audio/general/ios/session_category",   # 기본 Ambient — 무음 스위치에서 소리가 전부 사라진다
]

func _ready() -> void:
	var bad := 0
	for k in EXPECT:
		var has := ProjectSettings.has_setting(k)
		var v = ProjectSettings.get_setting(k) if has else null
		var ok: bool = has and typeof(v) == typeof(EXPECT[k]) and v == EXPECT[k]
		if not ok:
			bad += 1
		print("  %s %-58s = %s%s" % [
			"OK  " if ok else "FAIL", k, str(v),
			"" if ok else "  (기대 %s)" % str(EXPECT[k])])
	for k in EXIST:
		var has2 := ProjectSettings.has_setting(k)
		if not has2:
			bad += 1
		print("  %s %-58s = %s" % ["OK  " if has2 else "없음", k,
			str(ProjectSettings.get_setting(k)) if has2 else "-"])
	print("  오토로드 4개 상한: %s" % ", ".join(_autoloads()))
	if _autoloads().size() > 4:
		bad += 1
	get_tree().quit(1 if bad > 0 else 0)

func _autoloads() -> PackedStringArray:
	var out := PackedStringArray()
	for p in ProjectSettings.get_property_list():
		var n: String = p["name"]
		if n.begins_with("autoload/"):
			out.append(n.substr(9))
	return out
