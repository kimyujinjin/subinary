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
## 1패스 정렬 스크래치. 매 프레임 새로 만들지 않는다(규약: 프레임당 할당 0).
var _order := PackedInt32Array()
var _head := PackedInt32Array()
var _pos := PackedInt32Array()

func _ready() -> void:
	var m := CanvasItemMaterial.new()
	m.blend_mode = CanvasItemMaterial.BLEND_MODE_PREMULT_ALPHA
	material = m
	var built := BulletAtlas.build()
	_tex = built[0]
	_size = built[1]
	_head.resize(Tune.KIND_N + 1)
	_pos.resize(Tune.KIND_N + 1)

## 파이프라인 예열. Godot 은 그 조합(재질 × 블렌드 × 드로우 종류)이 **처음 제출될 때**
## 파이프라인을 만든다. 그래서 첫 탄이 화면에 뜨는 프레임에 힛치가 난다 —
## 스트레스 러너에서 첫 레벨만 max 22.18ms 로 튀고 이후 레벨은 12~18ms 였다(예열 신호).
## 실기는 컴파일이 더 느리므로 이 힛치가 첫 웨이브 위에 정확히 겹친다.
##
## 1×1 크기로 화면 최상단(HUD 띠 아래)에 그린다. 화면 밖 좌표로 밀면 래스터라이저가
## 잘라내고, 그러면 파이프라인이 안 만들어져 예열이 아무 일도 하지 않는다.
var warm_left: int = 0

func warm(frames: int) -> void:
	warm_left = frames

func _warm_draw() -> void:
	var r := Rect2(Vector2(0.0, 2.0), Vector2(1.0, 1.0))
	for t in _tex:
		draw_texture_rect(t, r, false)
		draw_texture_rect(t, r, false, Color(1.2, 1.2, 1.2, 1.0))   # modulate 경로(기포 경고)
	# 회전 경로(바늘)와 폴리라인 경로(잔광)는 별도 파이프라인이다.
	draw_set_transform(Vector2(0.0, 2.0), 0.3, Vector2.ONE)
	if not _tex.is_empty():
		draw_texture_rect(_tex[0], Rect2(Vector2.ZERO, Vector2.ONE), false)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	draw_polyline_colors(PackedVector2Array([Vector2(0.0, 2.0), Vector2(1.0, 3.0)]),
			PackedColorArray([Color(0, 0, 0, 0.02), Color(0, 0, 0, 0.02)]), 1.0, true)

func _draw() -> void:
	if warm_left > 0:
		warm_left -= 1
		_warm_draw()
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
	var cols := [Tune.COL_TIDE, Tune.COL_GRID, Tune.COL_NEEDLE, Tune.COL_BUBBLE,
			Tune.COL_POD, Tune.COL_GATE]
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
	#    패스를 나누면 원천적으로 생기지 않는다.
	#
	#    ── 1패스: 무회전 탄. **탄종별로 모아서** 그린다.
	#
	#    필드 순서대로 그리면 탄종이 섞여 텍스처가 매 탄 바뀌고, 그때마다 배치가 끊긴다.
	#    실측(scenes/stress.tscn): 3,000탄에서 드로우콜 1,161 — 탄당 0.39 다.
	#    폰은 드로우콜에 데스크톱보다 훨씬 민감하므로 이게 실기에서 먼저 아프다.
	#    계수 정렬 한 번(O(n))으로 같은 텍스처를 연속시키면 탄종 수만큼만 배치가 끊긴다.
	#
	#    탄종 간 겹침 순서가 바뀐다 — 그런데 그건 개선이다. 지금까지는 어느 탄이 위에
	#    올라오는지가 SoA 인덱스(= swap-remove 순서)에 따라 매 프레임 달라졌다.
	for k in Tune.KIND_N + 1:
		_head[k] = 0
	for i in cnt:
		var kc: int = pk[base + i]
		if Tune.KIND_H[kc] <= 0.0:
			_head[kc + 1] += 1
	for k in Tune.KIND_N:
		_head[k + 1] += _head[k]
	var flat: int = _head[Tune.KIND_N]
	if _order.size() < flat:
		_order.resize(flat)
	for k in Tune.KIND_N + 1:
		_pos[k] = _head[k]
	for i in cnt:
		var kc2: int = pk[base + i]
		if Tune.KIND_H[kc2] <= 0.0:
			_order[_pos[kc2]] = base + i
			_pos[kc2] += 1
	for t in flat:
		var j2: int = _order[t]
		var kd2: int = pk[j2]
		var sz: Vector2 = _size[kd2]
		var r := Rect2(Vector2(px[j2], py[j2]) - sz * 0.5, sz)
		if Tune.KIND_FUSE[kd2]:
			# 포낭 — 맥동 3회가 파열 카운트다운이다. 남은 퓨즈로 맥동 위상을 만든다.
			# 예고 없이 터지면 "1.2초의 계획 시간" 이라는 이 패턴의 전부가 사라진다.
			var fz: int = bf.fuse[j2] if base == 0 else Tune.POD_FUSE
			var seg := float(Tune.POD_FUSE) / float(Tune.POD_PULSES)
			var ph := 1.0 - fposmod(float(fz), seg) / seg
			var near := 1.0 - clampf(float(fz) / float(Tune.POD_FUSE), 0.0, 1.0)
			var mp := 1.0 + (0.35 + 1.25 * near) * ph * ph
			draw_texture_rect(_tex[kd2], r, false, Color(mp, mp, mp, 1.0))
		elif Tune.KIND_ACCEL[kd2]:
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
