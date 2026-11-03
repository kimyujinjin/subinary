extends Node
## 탄은 노드가 아니라 배열 인덱스다. SoA — 전체 탄을 이 클래스 하나가 소유한다.
## 공개 인터페이스(spawn / step_and_collide / 배열 접근)를 고정해 두면
## 실기 release 에서 탄 루프가 4ms 를 넘길 때 백엔드만 MultiMesh 로 교체할 수 있다.

const FLAG_GRAZED := 1

# 최초 1회 resize 후 재할당하지 않는다. 프레임 중 append/push_back/remove_at 금지 —
# 특히 remove_at(0) 은 O(n) 이다. 제거는 swap-with-last O(1).
var pos_x := PackedFloat32Array()
var pos_y := PackedFloat32Array()
var vel_x := PackedFloat32Array()
var vel_y := PackedFloat32Array()
## 상수 가속(유닛/s²). 기포만 쓴다 — 방사 방향의 반대로 걸어 감속 → 정지 → 역행을 만든다.
## 조류 이완과는 별개 축이다: 이완은 x 만 건드리고 목표 속도로 수렴시키지만,
## 이것은 발사 방향을 따라 선형으로 감속해 부호를 뒤집는다.
var acc_x := PackedFloat32Array()
var acc_y := PackedFloat32Array()
## 남은 퓨즈 틱. 0 이 되면 그 탄이 사라지면서 원형 산개를 낳는다(포낭).
## 단일 순회 안에서 spawn 하면 새 탄이 같은 틱에 한 번 더 적분되므로,
## 위치만 모아 두고 순회가 끝난 뒤 터뜨린다.
var fuse := PackedInt32Array()
var born := PackedInt32Array()   ## 생성 틱 — 수명 상한 컬링용
var _burst := PackedVector2Array()
var _burst_n: int = 0
var kind := PackedInt32Array()
var bid := PackedInt32Array()
var flags := PackedByteArray()
var n: int = 0

# 이번 틱의 판정 결과
var hit_index: int = -1
var hit_bid: int = 0
var hit_kind: int = 0
var graze_events: int = 0
var peak_n: int = 0

# 스윕 캡슐 오버레이용 — 이번 틱에 실제로 판정된 탄만 (수동 판정은 엔진의
# debug collision draw 혜택이 0이므로 우리가 직접 그린다)
var swept: PackedVector2Array = PackedVector2Array()

var _relax := PackedFloat32Array()   # DT/τ, 0 = 조류 면역
var _kw := PackedFloat32Array()
var _kh := PackedFloat32Array()
var _spawn_overflow: int = 0
var _next_bid: int = 1
var _swept_n: int = 0

# 강등 스위치 — 게이트 1 지표 ② 미달 시 감속한다. 상수화가 아니다.
## 조류 파라미터는 Difficulty 가 들고 있다. 예전에는 flow_slow 불리언 하나로 "강등" 을
## 흉내 냈는데, 게임에서 한 번도 켜지지 않았고(불변식 테스트만 썼다) 주기를 정수배로만
## 바꿀 수 있어 Hard(6초 = 0.75배)를 표현할 수 없었다.
## 전단 — 0 이면 평소 조류, 1 이면 완전 전단. 보스 P2 가 매 틱 넣는다.
## 시뮬과 배경이 **같은 값**을 쓰므로 시각과 판정이 어긋날 방법이 없다(설계서 §6).
## 국소 소용돌이(중간보스). 0 이면 고속 경로 그대로다.
var _now_tick: int = 0
var vortex_w: float = 0.0
var vortex_x: float = 0.0
var vortex_y: float = 0.0

var shear: float = 0.0
var shear_c: float = 1.0         ## 전단 시 하단 밴드의 방향
var shear_y: float = Tune.SHEAR_Y

func _ready() -> void:
	pos_x.resize(Tune.MAX_BULLETS)
	pos_y.resize(Tune.MAX_BULLETS)
	vel_x.resize(Tune.MAX_BULLETS)
	vel_y.resize(Tune.MAX_BULLETS)
	acc_x.resize(Tune.MAX_BULLETS)
	acc_y.resize(Tune.MAX_BULLETS)
	fuse.resize(Tune.MAX_BULLETS)
	born.resize(Tune.MAX_BULLETS)
	_burst.resize(64)
	kind.resize(Tune.MAX_BULLETS)
	bid.resize(Tune.MAX_BULLETS)
	flags.resize(Tune.MAX_BULLETS)
	swept.resize(Tune.MAX_BULLETS * 2)
	_relax.resize(Tune.KIND_N)
	_kw.resize(Tune.KIND_N)
	_kh.resize(Tune.KIND_N)
	for k in Tune.KIND_N:
		var tau: float = Tune.KIND_TAU[k]
		_relax[k] = 0.0 if tau <= 0.0 else Tune.DT / tau
		_kw[k] = Tune.KIND_W[k]
		_kh[k] = Tune.KIND_H[k]

func reset_flow() -> void:
	vortex_w = 0.0
	shear = 0.0
	shear_c = 1.0
	shear_y = Tune.SHEAR_Y

func clear() -> void:
	n = 0
	_swept_n = 0
	_burst_n = 0
	peak_n = 0
	graze_events = 0
	_spawn_overflow = 0

func spawn(x: float, y: float, vx: float, vy: float, k: int) -> void:
	spawn_acc(x, y, vx, vy, k, 0.0, 0.0)

func spawn_acc(x: float, y: float, vx: float, vy: float, k: int, ax: float, ay: float,
		fuse_ticks := -1) -> void:
	if n >= Tune.MAX_BULLETS:
		_spawn_overflow += 1
		return
	fuse[n] = fuse_ticks
	born[n] = _now_tick
	pos_x[n] = x
	pos_y[n] = y
	# 탄속 배율은 여기 한 곳에서만 건다. 패턴마다 걸면 빠뜨린 패턴이 생기고,
	# 그 패턴만 난이도를 안 따르는 것을 아무도 눈치채지 못한다.
	#
	# **가속도에도 같은 배율을 건다.** 기포는 v/a 가 정지 시각이므로 속도만 곱하면
	# 정지가 늦어져 "두 번 온다" 의 리듬이 난이도마다 달라진다. 둘 다 곱하면
	# 정지 시각은 그대로이고 도달 거리만 배율만큼 늘어난다 — 그게 의도한 축이다.
	var sm := Difficulty.speed_m
	vel_x[n] = vx * sm
	vel_y[n] = vy * sm
	acc_x[n] = ax * sm
	acc_y[n] = ay * sm
	kind[n] = k
	bid[n] = _next_bid
	_next_bid += 1
	flags[n] = 0
	n += 1

## 조류의 시간 성분 C(t) ∈ [-1, 1]. 부호 반전과 정지 창이 유일한 교재이므로
## 강등해도 구조는 전부 살려 두고 읽는 속도만 절반으로 만든다.
func flow_c(tick: int) -> float:
	var p: int = tick % Difficulty.period
	var i: int = 0
	var acc: int = 0
	while i < 3:
		var seg: int = Difficulty.segs[i]
		if p < acc + seg:
			break
		acc += seg
		i += 1
	var seg_len: int = Difficulty.segs[i]
	var local: int = p - acc
	var hold: int = seg_len - Difficulty.ramp
	var a: float = Tune.FLOW_LEVELS[i]
	if local < hold:
		return a
	var b: float = Tune.FLOW_LEVELS[(i + 1) % 4]
	return lerpf(a, b, float(local - hold) / float(Difficulty.ramp))

## 조류 세그먼트 (index, 세그먼트 내 국소 틱). index 0 = 우 · 1 = 정 · 2 = 좌 · 3 = 정.
## 보스 P1 의 압력/호흡 창이 이것이다 — 리듬을 따로 두지 않고 조류에서 직접 읽는다.
func flow_seg(tick: int) -> Vector2i:
	var p: int = tick % Difficulty.period
	var acc := 0
	for i in 4:
		var seg: int = Difficulty.segs[i]
		if p < acc + seg:
			return Vector2i(i, p - acc)
		acc += seg
	return Vector2i(3, 0)

## ∫₀^tick C(t) dt (틱 단위) — 조류 띠 눈금의 스크롤 위상.
##
## 위상을 tick × C(tick) 으로 계산했더니 램프 구간마다 눈금이 역주행했다:
## d/dt[t·C] = C + t·C' 이고 램프에서 t·C' 가 C 를 압도한다(t=3007 에서 유속은 오른쪽인데
## 눈금이 480 u/s 로 왼쪽으로 흘렀다). 게임의 유일한 조류 교재가 부호를 거꾸로 가르쳤다.
##
## 적분이어야 한다. FLOW_LEVELS = [1,0,-1,0] + 대칭 램프의 한 주기 적분이 정확히 0 이므로
## 주기 수를 셀 필요 없이 주기 내 위치만으로 닫힌다 — 누산기가 없어 드리프트도,
## 프레임당 물리 틱 수에 따른 어긋남도 없다.
func flow_phase(tick: int) -> float:
	var p: int = tick % Difficulty.period
	var ramp: int = Difficulty.ramp
	var ph := 0.0
	var acc := 0
	for i in 4:
		var seg: int = Difficulty.segs[i]
		var a: float = Tune.FLOW_LEVELS[i]
		var b: float = Tune.FLOW_LEVELS[(i + 1) % 4]
		var hold: int = seg - ramp
		var local: int = clampi(p - acc, 0, seg)
		ph += a * float(mini(local, hold))
		if local > hold:
			var d := float(local - hold)
			ph += (a + (b - a) * (d / float(ramp)) * 0.5) * d     # 램프는 사다리꼴
		acc += seg
	return ph

## 그 y 에서의 조류 시간 성분. 전단이 없으면 flow_c(tick) 그대로다.
##
## 전단 중에는 경계에서 ±1 로 부드럽게 갈리므로 경계 자체는 세기가 0 이다 —
## 그래서 경계에 있는 탄은 밀리지 않고 위아래 탄만 쓸려 나가 **통로가 남는다.**
## 그 지점의 소용돌이 속도(u/s). 적분 루프의 인라인 식과 **같은 식이어야 한다** —
## 렌더러(바늘 방향)와 배경이 이걸 쓰고, 갈라지면 시각과 판정이 어긋난다.
func vortex_at(x: float, y: float) -> Vector2:
	if vortex_w == 0.0:
		return Vector2.ZERO
	var dx := x - vortex_x
	var dy := y - vortex_y
	var d2 := dx * dx + dy * dy
	if d2 >= Tune.VORTEX_R2:
		return Vector2.ZERO
	var w := vortex_w * (1.0 - d2 * Tune.VORTEX_R2_INV)
	return Vector2(-dy * w, dx * w)

func flow_c_at(y: float, tick: int) -> float:
	var c := flow_c(tick)
	if shear <= 0.0:
		return c
	var b := clampf((y - shear_y) / Tune.SHEAR_SOFT, -1.0, 1.0)
	return lerpf(c, shear_c * b, shear)

## 깊이 프로파일 — 화면 중앙이 가장 빠르다
func flow_s(y: float) -> float:
	return Tune.FLOW_S_BASE + Tune.FLOW_S_AMP * sin(PI * clampf(y, 0.0, Tune.PF_H) / Tune.PF_H)

func flow_u(y: float, tick: int) -> float:
	var u_max: float = Difficulty.u_max
	return flow_c_at(y, tick) * flow_s(y) * u_max

## 한 번의 순회로 적분 → 컬링 → y 밴드 기각 → 통과분만 캡슐 스윕.
## p0/p1 은 이 틱의 플레이어 시작·끝 위치 (플레이어가 먼저 움직인 뒤 호출된다).
func step_and_collide(tick: int, p0: Vector2, p1: Vector2, invincible: bool) -> void:
	hit_index = -1
	_now_tick = tick
	var c := flow_c(tick)
	var u_max: float = Difficulty.u_max
	var swept_n := 0
	var i := 0
	while i < n:
		var kd := kind[i]
		var relax := _relax[kd]
		var ox := pos_x[i]
		var oy := pos_y[i]
		# ── 적분: 항력 이완. 측면 응답이 그 탄의 현재 vx 에 의존하므로 벽이 실제로 휜다.
		if relax > 0.0:
			# 전단이 없으면 c 는 루프 밖에서 이미 구한 값이다(고속 경로).
			var cy2 := c
			if shear > 0.0:
				cy2 = lerpf(c, shear_c * clampf((oy - shear_y) / Tune.SHEAR_SOFT, -1.0, 1.0), shear)
			var u := cy2 * (Tune.FLOW_S_BASE + Tune.FLOW_S_AMP * sin(PI * clampf(oy, 0.0, Tune.PF_H) / Tune.PF_H)) * u_max
			vel_x[i] += (u - vel_x[i]) * relax
		if Tune.KIND_ACCEL[kd]:
			vel_x[i] += acc_x[i] * Tune.DT
			vel_y[i] += acc_y[i] * Tune.DT
		var vx := vel_x[i]
		var vy := vel_y[i]
		# ── 국소 소용돌이: 매질이 돈다. 탄의 자기 속도에 더하지 않고 이 틱의 이동에만 실린다
		#    (vortex_at 과 같은 식이다 — 불변식이 둘이 일치하는지 확인한다).
		#    **조류 면역(τ=∞) 탄은 소용돌이도 안 탄다.** 소용돌이는 매질의 성질이고,
		#    물을 타지 않기로 한 탄이 물에 밀리면 "조류 0%" 라는 표시가 거짓말이 된다.
		#    바늘은 생성 시 회전이 고정되므로, 태우면 그림과 실제 진로가 어긋나기도 한다.
		if vortex_w != 0.0 and relax > 0.0:
			var dxv := ox - vortex_x
			var dyv := oy - vortex_y
			var d2v := dxv * dxv + dyv * dyv
			if d2v < Tune.VORTEX_R2:
				var wv := vortex_w * (1.0 - d2v * Tune.VORTEX_R2_INV)
				vx += -dyv * wv
				vy += dxv * wv
		var nx := ox + vx * Tune.DT
		var ny := oy + vy * Tune.DT
		pos_x[i] = nx
		pos_y[i] = ny
		# 퓨즈 — 위치 갱신 뒤에 본다. 터진 자리가 곧 산개 중심이다.
		if Tune.KIND_FUSE[kd]:
			fuse[i] -= 1
			if fuse[i] <= 0:
				if _burst_n < _burst.size():
					_burst[_burst_n] = Vector2(nx, ny)
					_burst_n += 1
				n -= 1
				pos_x[i] = pos_x[n]; pos_y[i] = pos_y[n]
				vel_x[i] = vel_x[n]; vel_y[i] = vel_y[n]
				acc_x[i] = acc_x[n]; acc_y[i] = acc_y[n]; fuse[i] = fuse[n]; born[i] = born[n]
				kind[i] = kind[n]; bid[i] = bid[n]; flags[i] = flags[n]
				continue

		# ── 화면밖 컬링 (swap-with-last)
		if nx < -48.0 or nx > Tune.PF_W + 48.0 or ny < -72.0 or ny > Tune.PF_H + 72.0 \
				or tick - born[i] > Tune.MAX_LIFE:
			n -= 1
			pos_x[i] = pos_x[n]; pos_y[i] = pos_y[n]
			vel_x[i] = vel_x[n]; vel_y[i] = vel_y[n]
			acc_x[i] = acc_x[n]; acc_y[i] = acc_y[n]; fuse[i] = fuse[n]; born[i] = born[n]
			kind[i] = kind[n]; bid[i] = bid[n]; flags[i] = flags[n]
			continue

		# ── y 밴드 기각. 임계값은 반드시 max(graze 반경) 기준 —
		#    hit 반경으로 쓰면 graze 가 조용히 사라지고 카운터만 0 에 가깝게 남는다.
		var rw := _kw[kd]
		var rh := _kh[kd]
		var c0y := oy - p0.y
		var c1y := ny - p1.y
		var band := Tune.GRAZE_R + rw + rh + Tune.MAX_STEP_PER_TICK
		if (c0y > band and c1y > band) or (c0y < -band and c1y < -band):
			i += 1
			continue

		# ── 캡슐 스윕. 점 vs 부풀린 선분 — 탄 중심의 상대 변위 선분을 축 방향으로
		#    양끝 h 만큼 연장한 뒤 최근접 거리를 (w + PLAYER_R) 과 비교한다.
		#    원형 탄은 h=0 이므로 분기가 늘지 않는다.
		var c0x := ox - p0.x
		var c1x := nx - p1.x
		if rh > 0.0:
			var sp := sqrt(vx * vx + vy * vy)
			if sp > 0.0001:
				var ax := vx / sp * rh
				var ay := vy / sp * rh
				c0x -= ax; c0y -= ay
				c1x += ax; c1y += ay
		if swept_n + 1 < swept.size():
			swept[swept_n] = Vector2(c0x + p1.x, c0y + p1.y)
			swept[swept_n + 1] = Vector2(c1x + p1.x, c1y + p1.y)
			swept_n += 2

		var d2 := _seg_dist2(c0x, c0y, c1x, c1y)
		var rhit := rw + Tune.PLAYER_R
		if d2 <= rhit * rhit:
			if not invincible and hit_index < 0:
				hit_index = i
				hit_bid = bid[i]
				hit_kind = kd
		else:
			var rgz := rw + Tune.GRAZE_R
			if d2 <= rgz * rgz and (flags[i] & FLAG_GRAZED) == 0:
				flags[i] = flags[i] | FLAG_GRAZED
				graze_events += 1
		i += 1

	_swept_n = swept_n
	# 순회가 끝난 뒤 터뜨린다 — 루프 안에서 spawn 하면 같은 틱에 한 번 더 적분된다.
	for b in _burst_n:
		var bc := _burst[b]
		for j in Tune.POD_BURST_COUNT:
			var ba := TAU * float(j) / float(Tune.POD_BURST_COUNT) + 0.2
			spawn(bc.x, bc.y, cos(ba) * Tune.POD_BURST_SPEED, sin(ba) * Tune.POD_BURST_SPEED,
					Tune.Kind.SPORE_TIDE)
	_burst_n = 0
	if n > peak_n:
		peak_n = n

func swept_count() -> int:
	return _swept_n

## 원점에서 선분까지의 최근접 거리의 제곱
func _seg_dist2(ax: float, ay: float, bx: float, by: float) -> float:
	var dx := bx - ax
	var dy := by - ay
	var l2 := dx * dx + dy * dy
	if l2 <= 0.000001:
		return ax * ax + ay * ay
	var t := clampf(-(ax * dx + ay * dy) / l2, 0.0, 1.0)
	var qx := ax + dx * t
	var qy := ay + dy * t
	return qx * qx + qy * qy

## 소광침 — 기체 위로 뻗는 폭 2·half 의 수직 기둥. 기둥 밖은 그대로 남는다.
func clear_column(cx: float, half_w: float, y_max: float) -> void:
	var i := 0
	while i < n:
		if absf(pos_x[i] - cx) <= half_w and pos_y[i] <= y_max:
			n -= 1
			pos_x[i] = pos_x[n]; pos_y[i] = pos_y[n]
			vel_x[i] = vel_x[n]; vel_y[i] = vel_y[n]
			acc_x[i] = acc_x[n]; acc_y[i] = acc_y[n]; fuse[i] = fuse[n]; born[i] = born[n]
			kind[i] = kind[n]; bid[i] = bid[n]; flags[i] = flags[n]
		else:
			i += 1

## 국소 소거 — 폭탄·부활용. 전탄 소거는 clear() 한 줄.
func clear_radius(cx: float, cy: float, r: float) -> void:
	var r2 := r * r
	var i := 0
	while i < n:
		var dx := pos_x[i] - cx
		var dy := pos_y[i] - cy
		if dx * dx + dy * dy <= r2:
			n -= 1
			pos_x[i] = pos_x[n]; pos_y[i] = pos_y[n]
			vel_x[i] = vel_x[n]; vel_y[i] = vel_y[n]
			acc_x[i] = acc_x[n]; acc_y[i] = acc_y[n]; fuse[i] = fuse[n]; born[i] = born[n]
			kind[i] = kind[n]; bid[i] = bid[n]; flags[i] = flags[n]
		else:
			i += 1
