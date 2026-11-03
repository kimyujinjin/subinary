class_name Sprites
## 비행 스프라이트 — 플레이 중 화면에 있는 **인물**이다.
##
## 이것이 없으면 메뉴와 대사에만 캐릭터가 있고 정작 5분 동안은 삼각형이 난다.
## "비행기 총 쏘는 느낌" 이 그 뜻이었다 — 캐릭터 게임인데 플레이 중엔 캐릭터가 없었다.
##
## 초상화(768×1024 반신)와 **다른 파일**이다. 초상화를 줄여서 쓰면 얼굴만 크게 보이고
## 날고 있는 몸이 안 보인다. 규격은 docs/ART_SPEC.md.

const PATHS := [
	"res://assets/sprites/s0_narin.png", "res://assets/sprites/s1_haemu.png",
]

static var _tex: Array[Texture2D] = []

static func _load_once() -> void:
	if not _tex.is_empty():
		return
	_tex.resize(PATHS.size())
	for i in PATHS.size():
		if ResourceLoader.exists(PATHS[i]):
			_tex[i] = load(PATHS[i]) as Texture2D

static func get_tex(i: int) -> Texture2D:
	_load_once()
	if i < 0 or i >= _tex.size():
		return null
	return _tex[i]

## 그 위치에 인물을 그린다. 반환: 그렸으면 true(못 그리면 호출부가 삼각형으로 되돌린다).
## 중심은 **판정 원 위치**다 — 발밑이 아니라 몸 가운데가 판정에 오게 한다.
static func draw_pilot(ci: CanvasItem, i: int, p: Vector2, a: float) -> bool:
	var t := get_tex(i)
	if t == null:
		return false
	var w := Tune.SHIP_SPRITE_W
	var h := w / Tune.SHIP_SPRITE_ASPECT
	ci.draw_texture_rect(t, Rect2(p - Vector2(w, h) * 0.5, Vector2(w, h)), false,
			Color(1.0, 1.0, 1.0, a))
	return true
