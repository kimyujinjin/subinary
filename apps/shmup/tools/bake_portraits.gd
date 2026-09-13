extends Node
## 초상화 PNG 를 굽는다 — `assets/portraits/*.png` 로 나간다.
##
## 나는 그림을 그릴 수 없다. 이 프로젝트는 애초에 "그림·음악 제작 불가" 를 전제로 설계됐다
## (설계서 §10). 그래서 **파이프라인을 진짜로 만들고 그림만 자리표시자로 둔다** —
## 게임은 지금 완성 상태로 돌고, 진짜 그림이 생기면 같은 이름의 파일로 덮으면 끝이다.
##
## 자리표시자라고 빈 상자를 두지 않는다. 빈 상자는 "아직 안 만들었다" 를 숨기지 못하면서
## 화면만 망가뜨린다. 인물마다 다른 실루엣·발광 무늬를 그려서 **누가 누구인지 구분되게** 한다.
## 세계관(심해 생물발광)과 같은 언어로 그리므로 진짜 그림이 와도 톤이 튀지 않는다.

## 규격(docs/ART_SPEC.md)과 같은 크기·비율로 굽는다. 자리표시자가 규격을 안 지키면
## 레이아웃을 자리표시자에 맞춰 놓고 진짜 그림이 왔을 때 다시 틀어진다.
const W := 768
const H := 1024
const MARGIN := 20.0        ## 가장자리 여백 — 모바일 텍스처 압축이 가장자리를 물어뜯는다
const OUT := "res://assets/portraits"
const FILES := ["p0_narin", "p1_haemu", "p2_tersa", "p3_corona"]
const SPR_OUT := "res://assets/sprites"
const SPR_FILES := ["s0_narin", "s1_haemu"]
const SPR_W := 256
const SPR_H := 320

func _ready() -> void:
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(OUT))
	for i in FILES.size():
		var img := _bake(i, W, H)
		var path := "%s/%s.png" % [OUT, FILES[i]]
		var err := img.save_png(ProjectSettings.globalize_path(path))
		print("  %s  %s" % [path, "ok" if err == OK else "err %d" % err])
	# 비행 스프라이트 — 초상화와 **다른 파일**이다. 플레이 중 화면에 계속 있는 것이라
	# 작게 그려지고, 그래서 실루엣이 전부다.
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(SPR_OUT))
	for i in SPR_FILES.size():
		var img := _bake(i, SPR_W, SPR_H)
		var path := "%s/%s.png" % [SPR_OUT, SPR_FILES[i]]
		var err := img.save_png(ProjectSettings.globalize_path(path))
		print("  %s  %s" % [path, "ok" if err == OK else "err %d" % err])
	print("== 초상화 4장 + 비행 스프라이트 2장 ==")
	get_tree().quit(0)

## 0 나린 · 1 해무 · 2 테르사(방추체) · 3 코로나(화륜종)
func _bake(who: int, iw: int, ih: int) -> Image:
	var img := Image.create(iw, ih, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	var hue: float = [0.46, 0.55, 0.10, 0.02][who]
	var base := Color.from_hsv(hue, 0.55, 0.95)
	var dark := Color.from_hsv(hue, 0.75, 0.16)
	# 얼굴이 위쪽 40%% 안에 오도록 중심을 위로 올린다(규격).
	var c := Vector2(iw * 0.5, ih * 0.46)
	var span := float(ih) - MARGIN * 2.0
	for y in ih:
		for x in iw:
			var p := Vector2(x, y)
			var d := (p - c) / span
			var a := _shape(who, d)
			# 가장자리 여백을 **굽는 쪽에서** 강제한다. 검사기가 자기 자리표시자를 잡는 것을
			# 보고 고쳤다 — 규격을 만든 사람이 규격을 안 지키면 그 규격은 무시당한다.
			a *= clampf(minf(minf(float(x), float(iw - 1 - x)),
					minf(float(y), float(ih - 1 - y))) - MARGIN, 0.0, 8.0) / 8.0
			if a <= 0.0:
				continue
			var glow := _glow(who, d)
			var col := dark.lerp(base, clampf(glow, 0.0, 1.0))
			img.set_pixel(x, y, Color(col.r, col.g, col.b, clampf(a, 0.0, 1.0)))
	return img

## 실루엣. 인물마다 다른 윤곽 — 조종사는 사람 형태, 보스는 그 몸 자체다.
func _shape(who: int, d: Vector2) -> float:
	match who:
		0, 1:
			# 조종사 — **머리 위 표식이 실루엣을 만든다**(장르 문법 1).
			# 나린은 넓게 퍼진 테, 해무는 곧게 선 관. 얼굴이 안 보여도 둘이 안 섞인다.
			var w: float = 0.26 if who == 0 else 0.20
			var head: float = Vector2(d.x / (w * 0.66), (d.y + 0.20) / (w * 0.74)).length()
			var body: float = Vector2(d.x / w, (d.y - 0.26) / (w * 1.6)).length()
			var mark := 9.9
			if who == 0:
				# 넓은 테 — 머리 위를 가로지르는 납작한 타원
				mark = Vector2(d.x / 0.30, (d.y + 0.34) / 0.045).length()
			else:
				# 높은 관 — 머리 위로 곧게 선 좁은 기둥
				mark = Vector2(d.x / 0.035, (d.y + 0.40) / 0.17).length()
			return _edge(1.0 - minf(minf(head, body), mark))
		2:
			# 테르사 — 세로 방추. 게임의 몸통과 같은 형태다.
			var q: float = 1.0 - pow(clampf(d.y / 0.46, -1.0, 1.0), 2.0)
			var half: float = 0.16 * pow(maxf(q, 0.0), 0.62)
			return _edge((half - absf(d.x)) * 6.0)
		_:
			# 코로나 — 링 3겹을 가진 구체.
			return _edge((0.40 - d.length()) * 6.0)

## 발광 무늬. "물의 상태가 몸에 그려져 있다" 는 이 게임의 규칙을 초상화에도 적용한다.
func _glow(who: int, d: Vector2) -> float:
	match who:
		0:
			# **가로 줄** — 나린의 사격은 넓다. 무늬 방향이 곧 그 사람의 탄이다(규격 문법 3).
			return 0.35 + 0.65 * absf(sin(d.y * 22.0))
		1:
			# **세로 줄** — 해무의 사격은 한 줄이다.
			return 0.30 + 0.70 * absf(sin(d.x * 34.0))
		2:
			return 0.25 + 0.75 * absf(sin((d.x * 3.2 + d.y) * 18.0))    # 비틀린 나선
		_:
			var r: float = d.length()
			return 0.20 + 0.80 * absf(sin(r * 46.0))                    # 동심 링

## 가장자리 1픽셀 안티에일리어싱. 계단이 보이면 자리표시자가 아니라 그냥 못 만든 것이다.
func _edge(v: float) -> float:
	return clampf(v * 1024.0 * 0.05, 0.0, 1.0)
