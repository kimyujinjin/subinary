class_name BulletRenderer
extends Node2D
## 탄 렌더 — 사전곱셈 텍스처 + 단일 _draw(). 셰이더 0줄, MultiMesh 0개.
##
## 게이트 5 에서 이 클래스의 _draw 하나만 MultiMesh + premul SDF 셰이더로 교체한다.
## 그때 BulletField 의 공개 인터페이스는 건드리지 않는다.

## 사망 교재 중에는 리플레이 프레임을 **같은 텍스처·회전·잔광**으로 그린다.
## 이 레이어를 교재 중에 재드로우하지 않았더니 사망 프레임의 탄이 얼어붙은 채 남고
## 그 위로 0.5초 과거의 교재 탄이 따로 그려져 모든 탄이 두 벌로 보였다 —
## 하나는 정지, 하나는 과거에서 미끄러져 들어온다. 실기 증상 "순간이동" 의 한 축이다.
var main: Node = null

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
	var st: int = SimClock.state
	if main != null and (st == SimClock.State.DEATH_REPLAY or st == SimClock.State.DEATH_FROZEN):
		var rp: Replay = main.replay
		if rp.length() == 0:
			return
		var step := clampi(int(main.lesson_step), 0, rp.length() - 1)
		_draw_set(rp.xs, rp.ys, rp.vxs, rp.vys, rp.kinds,
				rp.base_of(step), rp.frame_count(step), rp.frame_tick(step))
		return
	var bf := BulletField
	_draw_set(bf.pos_x, bf.pos_y, bf.vel_x, bf.vel_y, bf.kind, 0, bf.n, SimClock.sim_tick)

## 실시간과 교재가 공유하는 단일 드로우 경로. 두 경로가 갈라지면 외형이 갈라진다.
func _draw_set(px: PackedFloat32Array, py: PackedFloat32Array,
		pvx: PackedFloat32Array, pvy: PackedFloat32Array, pk: PackedInt32Array,
		base: int, cnt: int, tick: int) -> void:
	var bf := BulletField
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
	var cols := [Tune.COL_TIDE, Tune.COL_GRID, Tune.COL_NEEDLE, Tune.COL_BUBBLE]
	var c_t := bf.flow_c(tick)
	var u_max: float = Tune.FLOW_SLOW_U_MAX if bf.flow_slow else Tune.FLOW_U_MAX
	for i in cnt:
		var j := base + i
		var kd: int = pk[j]
		var span: float = Tune.KIND_TRAIL[kd]
		var x: float = px[j]
		var y: float = py[j]
		var vx: float = pvx[j]
		var vy: float = pvy[j]
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

	# ── 본체. 탄종을 두 패스로 나눈다.
	#
	#    draw_set_transform() 은 캔버스 아이템의 **상태를 남긴다**. 한 루프 안에서
	#    회전 탄과 무회전 탄을 섞으면, 바늘을 그린 뒤 다음에 오는 원형 탄이 그
	#    바늘의 위치·회전 좌표계로 변환되어 그려진다 — 실기에서 "총알이 갑자기 변하고
	#    순간이동한다" 로 보고된 증상의 원인이다. SoA 에서 바늘의 인덱스가 swap-remove 로
	#    매 프레임 바뀌므로 어느 탄이 틀어지는지도 계속 변한다.
	#
	#    패스를 나누면 원천적으로 생기지 않고, 무회전 패스가 통째로 배칭되어 더 싸다.
	#    ── 1패스: 무회전 탄 (transform 을 건드리지 않는다)
	for i in cnt:
		var j2 := base + i
		var kd2: int = pk[j2]
		if Tune.KIND_H[kd2] > 0.0:
			continue
		var sz: Vector2 = _size[kd2]
		var r := Rect2(Vector2(px[j2], py[j2]) - sz * 0.5, sz)
		if Tune.KIND_ACCEL[kd2]:
			# 기포 — 정지가 가까울수록 테두리가 밝아진다. "곧 되돌아온다" 예고이고,
			# 이 경고가 없으면 역행이 기습이 되어 "두 번 온다" 를 배울 방법이 없다.
			# modulate 는 성분별이므로 rgb 만 올린다(알파를 올리면 사전곱셈이 깨진다).
			var sp := sqrt(pvx[j2] * pvx[j2] + pvy[j2] * pvy[j2])
			var a2 := sqrt(bf.acc_x[j2] * bf.acc_x[j2] + bf.acc_y[j2] * bf.acc_y[j2])
			var warn := 0.0
			if a2 > 0.001:
				warn = clampf(1.0 - sp / (a2 * Tune.BUBBLE_WARN_SEC), 0.0, 1.0)
			var m := lerpf(1.0, Tune.BUBBLE_WARN_MULT, warn)
			draw_texture_rect(_tex[kd2], r, false, Color(m, m, m, 1.0))
		else:
			draw_texture_rect(_tex[kd2], r, false)

	#    ── 2패스: 회전 탄 (바늘). τ=∞ 라 회전은 생성 시 고정이다.
	var rotated := false
	for i in cnt:
		var j3 := base + i
		var kd3: int = pk[j3]
		if Tune.KIND_H[kd3] <= 0.0:
			continue
		var sz3: Vector2 = _size[kd3]
		var rot := atan2(pvy[j3], pvx[j3]) - PI * 0.5
		draw_set_transform(Vector2(px[j3], py[j3]), rot, Vector2.ONE)
		draw_texture_rect(_tex[kd3], Rect2(-sz3 * 0.5, sz3), false)
		rotated = true
	if rotated:
		draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
