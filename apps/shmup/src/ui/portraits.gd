class_name Portraits
## 초상화 로더. `assets/portraits/p0..p3.png` 를 한 번만 읽어 들고 있는다.
##
## **이 프로젝트에서 처음으로 이미지 애셋이 들어온 자리다.** 그 전까지는 모든 그림이
## 코드였다(탄·보스·배경·화면). 초상화만 예외인 이유: 인물의 얼굴은 절차적 도형으로는
## 안 되고, 캐릭터를 넣기로 한 이상 얼굴 없이는 캐릭터가 아니기 때문이다.
##
## 지금 들어 있는 4장은 `tools/bake_portraits.gd` 가 구운 **자리표시자**다 —
## 나는 그림을 그릴 수 없고, 이 프로젝트는 그 전제로 설계됐다(설계서 §10).
## 진짜 그림이 생기면 같은 이름으로 덮으면 된다. 파이프라인은 이미 진짜다.
##
## 파일이 없어도 게임은 돈다. 없으면 그 자리에 링 실루엣을 그린다 —
## 초상화 하나가 없다고 화면이 깨지면 안 된다.

## 규격은 docs/ART_SPEC.md 에 있다. 파일명이 계약이다 — 같은 이름으로 덮으면 끝난다.
const PATHS := [
	"res://assets/portraits/p0_narin.png", "res://assets/portraits/p1_haemu.png",
	"res://assets/portraits/p2_tersa.png", "res://assets/portraits/p3_corona.png",
]
## 규격 비율 3:4(반신). 이 비율에서 벗어난 그림도 **잘리지 않고** 들어간다 —
## 잘라 내면 받은 그림이 화면에서 다르게 보이고, 그 차이를 그린 사람이 모른다.
const ASPECT := 0.75

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

## 규격 비율로 맞춘 사각형. 주어진 폭·높이 안에 3:4 를 끼워 넣는다.
static func fit(r: Rect2) -> Rect2:
	var w: float = minf(r.size.x, r.size.y * ASPECT)
	var h: float = w / ASPECT
	return Rect2(r.get_center() - Vector2(w, h) * 0.5, Vector2(w, h))

## 주어진 사각형에 **비율을 지키며** 그린다. 없으면 대체 도형.
static func draw_into(ci: CanvasItem, i: int, r: Rect2) -> void:
	var t := get_tex(i)
	if t == null:
		var c := r.get_center()
		var rad: float = minf(r.size.x, r.size.y) * 0.42
		for k in 3:
			ci.draw_arc(c, rad * (1.0 - 0.22 * float(k)), 0.0, TAU, 40,
					Color(0.35, 0.90, 0.85, 0.45), 2.0, true)
		return
	var ts := t.get_size()
	var sc: float = minf(r.size.x / ts.x, r.size.y / ts.y)
	var d := ts * sc
	ci.draw_texture_rect(t, Rect2(r.get_center() - d * 0.5, d), false)
