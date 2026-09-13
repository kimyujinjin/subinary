extends Node2D
## 받은 초상화를 **실제 화면 그대로** 본다. 선택 화면과 대사 화면을 번갈아 띄운다.
## 탭·아무 키로 다음. 그림을 덮은 뒤 이것만 돌리면 "화면에서 어떻게 보이는가" 가 끝난다.
var _sh: Shell = null
var _i := 0
const ORDER := [Shell.Screen.PILOT, Shell.Screen.TALK]

func _ready() -> void:
	SaveData.reset_for_test("user://save-preview.json")
	_sh = Shell.new()
	_sh.vh = float(get_viewport().get_visible_rect().size.y)
	_sh.view_w = float(get_viewport().get_visible_rect().size.x)
	add_child(_sh)
	_apply()

func _apply() -> void:
	var s: int = ORDER[_i % ORDER.size()]
	_sh.screen = s
	if s == Shell.Screen.TALK:
		# 대사는 네 인물이 모두 나오도록 중간보스/보스를 번갈아 본다.
		var pair := (_i / ORDER.size()) % 2
		_sh.talk_script = Cast.MID_TALK if pair == 0 else Cast.BOSS_TALK
		_sh.talk_opponent = 2 if pair == 0 else 3
		_sh.talk_line = (_i / (ORDER.size() * 2)) % _sh.talk_script.size()
		Cast.pilot = pair
	_sh.queue_redraw()

func _unhandled_input(event: InputEvent) -> void:
	var go := false
	if event is InputEventScreenTouch and (event as InputEventScreenTouch).pressed:
		go = true
	if event is InputEventMouseButton and (event as InputEventMouseButton).pressed:
		go = true
	if event is InputEventKey and (event as InputEventKey).pressed:
		if (event as InputEventKey).keycode == KEY_ESCAPE:
			get_tree().quit(0)
			return
		go = true
	if go:
		_i += 1
		_apply()
		get_viewport().set_input_as_handled()
