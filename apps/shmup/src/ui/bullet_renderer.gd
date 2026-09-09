class_name BulletRenderer
extends Node2D
## 탄 렌더 — 사전곱셈 텍스처 + 단일 _draw(). 셰이더 0줄, MultiMesh 0개.
##
## 게이트 5 에서 이 클래스의 _draw 하나만 MultiMesh + premul SDF 셰이더로 교체한다.
## 그때 BulletField 의 공개 인터페이스는 건드리지 않는다.

var _tex: Array[ImageTexture] = []
var _size: Array[Vector2] = []
var _trail := PackedVector2Array()
var _trail_col := PackedColorArray()

func _ready() -> void:
	var m := CanvasItemMaterial.new()
	m.blend_mode = CanvasItemMaterial.BLEND_MODE_PREMULT_ALPHA
	material = m
	var built := BulletAtlas.build()
	_tex = built[0]
	_size = built[1]

func _draw() -> void:
	var bf := BulletField
	var cnt: int = bf.n
	# ── 잔광 궤적선. "휘어짐"이 조류 표시의 3번째 채널이다.
	#
	#    직선 2점으로 그리면 방향만 보이고 휘어짐은 보이지 않는다 — 그러면 이 채널이
	#    존재하지 않는 것과 같다. 운동방정식이 v_x' = (u − v_x)/τ 로 알려져 있으므로
	#    가속 항까지 써서 최근 경로를 2차까지 역적분한다:
	#        x(−s) = x − v_x·s + ½·a_x·s²      a_x = (u − v_x)/τ
	#        y(−s) = y − v_y·s                 (v_y 는 상수)
	#    2구간(3점) 폴리라인이면 곡률이 눈에 보인다. draw_multiline 은 여전히 커맨드 1개다.
	var seg_n := cnt * 2
	_trail.resize(seg_n * 2)
	_trail_col.resize(seg_n)
	var cols := [Tune.COL_TIDE, Tune.COL_GRID, Tune.COL_NEEDLE]
	var tick: int = SimClock.sim_tick
	var c_t := bf.flow_c(tick)
	var u_max: float = Tune.FLOW_SLOW_U_MAX if bf.flow_slow else Tune.FLOW_U_MAX
	for i in cnt:
		var kd: int = bf.kind[i]
		var span: float = Tune.KIND_TRAIL[kd]
		var x: float = bf.pos_x[i]
		var y: float = bf.pos_y[i]
		var vx: float = bf.vel_x[i]
		var vy: float = bf.vel_y[i]
		var tau: float = Tune.KIND_TAU[kd]
		var ax := 0.0
		if tau > 0.0:
			ax = (c_t * bf.flow_s(y) * u_max - vx) / tau
		var h := span * 0.5
		var mx := x - vx * h + 0.5 * ax * h * h
		var my := y - vy * h
		var ex := x - vx * span + 0.5 * ax * span * span
		var ey := y - vy * span
		_trail[i * 4] = Vector2(ex, ey)
		_trail[i * 4 + 1] = Vector2(mx, my)
		_trail[i * 4 + 2] = Vector2(mx, my)
		_trail[i * 4 + 3] = Vector2(x, y)
		var c: Color = cols[kd]
		# 사전곱셈: rgb 를 alpha 로 미리 곱한다. 뒤쪽 구간이 더 옅다.
		# draw_multiline_colors 는 colors.size() * 2 == points.size() 를 강제한다 —
		# 구간당 색 하나다. 점당 하나로 넣으면 엔진이 프레임마다 에러를 뱉고 선이 사라진다.
		_trail_col[i * 2] = Color(c.r * 0.18, c.g * 0.18, c.b * 0.18, 0.18)
		_trail_col[i * 2 + 1] = Color(c.r * 0.42, c.g * 0.42, c.b * 0.42, 0.42)
	if cnt > 0:
		draw_multiline_colors(_trail, _trail_col, 2.5)

	# ── 본체. 원형(포자)은 회전이 없으므로 draw_texture_rect 로 배칭되고,
	#    바늘만 draw_set_transform 을 쓴다 (τ=∞ 라 회전은 생성 시 고정이다).
	for i in cnt:
		var kd2: int = bf.kind[i]
		var sz: Vector2 = _size[kd2]
		var p := Vector2(bf.pos_x[i], bf.pos_y[i])
		if Tune.KIND_H[kd2] <= 0.0:
			draw_texture_rect(_tex[kd2], Rect2(p - sz * 0.5, sz), false)
		else:
			var rot := atan2(bf.vel_y[i], bf.vel_x[i]) - PI * 0.5
			draw_set_transform(p, rot, Vector2.ONE)
			draw_texture_rect(_tex[kd2], Rect2(-sz * 0.5, sz), false)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
