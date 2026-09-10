class_name BulletAtlas
## 탄 텍스처를 코드에서 굽는다 — 이미지 애셋 0개.
##
## CanvasItemMaterial(BLEND_MODE_PREMULT_ALPHA) 의 결과는 src.rgb + dst.rgb·(1−src.a) 다.
## 그래서 한 텍스처 안에서
##   코어 (rgb = 색, a = 1.0)                  → 불투명 발광 코어
##   림   (rgb ≈ 0, a ≈ 0.85 → 배경을 어둡게)  → 검은 테두리
##   헤일로(rgb = 색·0.3, a ≈ 0.05)            → 가산 글로우
## 가 동시에 나온다. 순수 additive 로는 원천적으로 불가능한 부분이고
## 포스트프로세스 0개·드로우콜 추가 0개다.
##
## hdr_2d 와 전역 블룸을 쓰지 않는 이유: 블룸은 탄 엣지를 뭉개서 가독성을 직접 해친다.
## 성능이 아니라 가독성 근거로 기각했다.

const PPU := 3.0            # 텍셀/유닛 — 실기 1.5px/unit 의 2배 슈퍼샘플
const RIM := 2.2            # 검은 테두리 두께(유닛)
const AA := 0.9             # 안티에일리어싱 폭(유닛)
const RIM_A := 0.85
const HALO_A := 0.055
const HALO_RGB := 0.34

## 캡슐 SDF 로 한 장을 굽는다. h=0 이면 원, h>0 이면 세로 캡슐(바늘).
static func bake(color: Color, w: float, h: float, halo: float) -> ImageTexture:
	# 림·AA 두께를 탄 크기로 클램프한다. 고정값을 쓰면 얇은 탄에서
	# 림이 코어를 통째로 덮어 "검은 림만 남은 투명한 탄" 이 된다(바늘에서 실측).
	var rim := minf(RIM, w * 0.42)
	var aa := minf(AA, w * 0.30)
	var pad := halo + aa
	var hx := w + pad
	var hy := h + w + pad
	var sx := int(ceil(hx * 2.0 * PPU))
	var sy := int(ceil(hy * 2.0 * PPU))
	var img := Image.create_empty(sx, sy, false, Image.FORMAT_RGBA8)
	for py in sy:
		var uy := (float(py) + 0.5) / PPU - hy
		for px in sx:
			var ux := (float(px) + 0.5) / PPU - hx
			# 세로 선분(±h)까지의 거리 − w = 표면까지의 부호거리
			var cy := clampf(uy, -h, h)
			var d := sqrt(ux * ux + (uy - cy) * (uy - cy)) - w
			img.set_pixel(px, py, _shade(color, d, halo, rim, aa))
	return ImageTexture.create_from_image(img)

static func _shade(c: Color, d: float, halo: float, rim: float, aa: float) -> Color:
	if d < -rim - aa:
		return Color(c.r, c.g, c.b, 1.0)                       # 코어
	if d < -rim:
		var t := smoothstep(-rim - aa, -rim, d)                # 코어 → 림
		var a := lerpf(1.0, RIM_A, t)
		return Color(lerpf(c.r, 0.02, t), lerpf(c.g, 0.03, t), lerpf(c.b, 0.04, t), a)
	if d < 0.0:
		return Color(0.02, 0.03, 0.04, RIM_A)                  # 림 (배경을 어둡게)
	if halo <= 0.0:
		var t2 := smoothstep(0.0, aa, d)                       # 헤일로 없음 → 즉시 소멸
		var a2 := lerpf(RIM_A, 0.0, t2)
		return Color(0.02 * (1.0 - t2), 0.03 * (1.0 - t2), 0.04 * (1.0 - t2), a2)
	if d < halo:
		var f := 1.0 - d / halo
		f = f * f
		return Color(c.r * HALO_RGB * f, c.g * HALO_RGB * f, c.b * HALO_RGB * f, HALO_A * f)
	return Color(0.0, 0.0, 0.0, 0.0)

## 탄종별 텍스처 + 각 텍스처의 유닛 크기. 스테이지 시작 시 1회.
static func build() -> Array:
	var texs: Array[ImageTexture] = []
	var sizes: Array[Vector2] = []
	var cols := [Tune.COL_TIDE, Tune.COL_GRID, Tune.COL_NEEDLE]
	for k in Tune.KIND_N:
		# 시각 반폭으로 굽는다. 판정 반폭(KIND_W)과 분리되어 있다.
		var w: float = Tune.KIND_VIS_W[k]
		var h: float = Tune.KIND_H[k]
		var halo: float = Tune.KIND_HALO[k]
		texs.append(bake(cols[k], w, h, halo))
		var pad: float = halo + minf(AA, w * 0.30)
		sizes.append(Vector2((w + pad) * 2.0, (h + w + pad) * 2.0))
	return [texs, sizes]
