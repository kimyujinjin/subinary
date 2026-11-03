class_name EnemySprites
## 적 그림 — **실루엣이 곧 경고**라는 규칙 아래에서만 쓴다.
##
## 적의 실루엣은 "무엇을 강요하는 적인가" 를 말한다(설계서 §6). 그림이 그 경고를 흐리면
## 넣지 않는 것이 낫다. 그래서 파일이 없는 종은 **절차적 도형 그대로** 간다 —
## 군체 등해파리(코어·몸통)는 지금 그림이 없고, 도형이 그 역할을 하고 있다.
##
## 위에서 내려다보는 화면이므로 그림도 top-down 이다. 세로로 긴 종(뱀장어)과
## 가로로 긴 종(침어)이 있어 비율을 지켜 그린다 — 정사각형에 욱여넣으면 침어가 뭉툭해진다.

## EnemyField.Type 순서다. 빈 칸은 그림이 없다는 뜻(도형으로 되돌아간다).
const PATHS := [
	"res://assets/enemies/e0_drifter.png",
	"res://assets/enemies/e1_needlefish.png",
	"res://assets/enemies/e2_medusa.png",
	"res://assets/enemies/e3_tube.png",
	"res://assets/enemies/e4_podworm.png",
	"",                                        # 군체 코어 — 그림 없음
	"",                                        # 군체 몸통 — 그림 없음
	"res://assets/enemies/e7_eel.png",
]
## 시각 크기 배율(R_VIS 기준). 길쭉한 종은 긴 축이 판정 반경보다 커야 생물로 보인다.
const SCALE := [2.2, 3.0, 2.2, 2.4, 2.6, 1.0, 1.0, 3.2]

static var _tex: Array[Texture2D] = []

static func _load_once() -> void:
	if not _tex.is_empty():
		return
	_tex.resize(PATHS.size())
	for i in PATHS.size():
		if PATHS[i] != "" and ResourceLoader.exists(PATHS[i]):
			_tex[i] = load(PATHS[i]) as Texture2D

## 그렸으면 true. 못 그리면 호출부가 절차적 도형으로 되돌아간다.
static func draw_enemy(ci: CanvasItem, t: int, p: Vector2, r_vis: float) -> bool:
	_load_once()
	if t < 0 or t >= _tex.size() or _tex[t] == null:
		return false
	var tex: Texture2D = _tex[t]
	var ts := tex.get_size()
	# 긴 축을 r_vis × 배율에 맞춘다. 비율을 지켜야 침어가 바늘로, 뱀장어가 뱀으로 보인다.
	var long_side: float = r_vis * SCALE[t]
	var sc: float = long_side / maxf(ts.x, ts.y)
	var d := ts * sc
	ci.draw_texture_rect(tex, Rect2(p - d * 0.5, d), false)
	return true
