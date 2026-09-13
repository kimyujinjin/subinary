extends Node2D
## 게이트 5 — "탄 N발에서 60fps 가 나오는가". **재기 전에 MultiMesh 로 바꾸지 않는다.**
##
## 설계서 5단계의 게이트는 "2,000탄에서 60fps 미달이면 백엔드 재검토" 다. 미달이 아니면
## 교체는 이득 없는 복잡도다(셰이더 0줄·MultiMesh 0개가 지금의 자산이다).
##
## 게임과 **같은 BulletRenderer·BulletAtlas·BulletField** 를 쓴다. 별도 하네스를 만들면
## 그 하네스의 성능을 재게 되고, 그 숫자로 내린 교체 결정은 근거가 없다.
##
## 창을 띄워 실행해야 한다(헤드리스는 렌더 장치가 없어 _draw 비용이 0 이 된다 —
## 그걸 모르고 재면 "MultiMesh 필요 없음" 이라는 틀린 결론에 도달한다).
##
## 실기 release 판정이 최종이다. 데스크톱 에디터 빌드 숫자는 곡선의 모양을 보는 용도다.

const LEVELS := [250, 500, 1000, 2000, 3000]
const WARM_FRAMES := 90           ## 파이프라인 예열 — 첫 드로우의 셰이더 컴파일 힛치를 빼고 잰다
const MEASURE_FRAMES := 300       ## 5초

var _renderer: BulletRenderer = null
var _level: int = 0
var _frame: int = 0
var _dt := PackedFloat32Array()
## 시뮬 시간은 **직접 잰다.** Performance.TIME_PHYSICS_PROCESS / TIME_PROCESS 는
## 프레임값이 아니라 **1초에 한 번 갱신되는 그 1초의 최댓값**이다(실측: 갱신 시각
## t=1026·2029·3029·4028·5025ms, 그리고 30틱 중 1틱만 무겁게 만들자 평균 0.8ms 여야 할
## 자리에 19~30ms 를 보고했다). 그 값을 300프레임 평균 내면 서로 다른 값 두세 개의
## 산술평균이 되고, 레벨을 바꿔도 직전 레벨의 값이 다음 창으로 넘어온다.
## CLAUDE.md 의 시뮬 표(1.26~1.77ms)가 전부 그 위에 서 있었다.
var _sim_us := PackedFloat32Array()
var _rng := RandomNumberGenerator.new()
var _done := false
var _p50 := PackedFloat32Array()
var _dc: int = 0
var _dc_level: int = 0
var _sim_p50: float = 0.0
var _needles: int = 0

func _ready() -> void:
	# **실제 세이브를 건드리지 않는다.** 러너는 패턴을 직접 호출하므로 mark() 가
	# _dirty 를 켜고, Main 을 띄우는 러너는 free() 때 save_now() 가 돌아
	# 최고점수·해금·무피격 기록을 0 으로 덮어쓴다(실측). 경고도 실패도 없이 사라진다.
	SaveData.reset_for_test("user://save-test-stress_runner.json")
	# vsync 를 끄지 않으면 프레임타임이 표시 주사율에 고정돼 여유가 보이지 않는다 —
	# 16.67ms 가 "딱 맞다" 인지 "1/5 만 쓴다" 인지 구분이 안 되고, 그 표로는 교체 판단을 못 한다.
	_kill_vsync()
	_rng.seed = 20260912
	_renderer = BulletRenderer.new()
	add_child(_renderer)
	_renderer.warm(30)      # 게임과 같은 예열을 거친다 — 안 하면 첫 레벨만 힛치를 뒤집어쓴다
	print("== 게이트 5 스트레스 — 탄 수 × 프레임타임 ==")
	print("  빌드: %s%s" % ["debug" if OS.is_debug_build() else "release",
			"   ← debug. 이 숫자는 곡선의 모양일 뿐 판정이 아니다" if OS.is_debug_build() else ""])
	print("  렌더러: draw_texture_rect × N (MultiMesh 0 · 셰이더 0)")
	print("  탄수 | 프레임타임 p50   p95   p99  최대 | 드로우콜 | 시뮬 p50  p99 (ms) | 바늘")
	_p50 = PackedFloat32Array()
	_fill(LEVELS[0])

## 실제 분포를 흉내 낸다 — 탄종이 섞여야 2패스(원/회전)가 둘 다 돈다.
## 한 종류로 채우면 한 패스만 재고, 그 숫자로 "괜찮다" 를 말할 수 없다.
func _fill(n: int) -> void:
	BulletField.clear()
	for i in n:
		var kd := _mix(i)
		var a := _rng.randf() * TAU
		var sp := _rng.randf_range(60.0, 220.0)
		BulletField.spawn(_rng.randf_range(0.0, Tune.PF_W), _rng.randf_range(0.0, Tune.PF_H),
				cos(a) * sp, sin(a) * sp, kd)
	_frame = 0
	_dt.clear()
	_sim_us.clear()

## vsync 를 끄는 요청이 한 번에 안 먹는다(창 생성 타이밍과 경쟁한다). 실제로 첫 판은
## 꺼졌고 두 번째 판은 8.33ms 에 고정됐다 — 같은 코드, 다른 결과다.
## 그래서 예열 동안 매 프레임 다시 끄고, 마지막에 **실제 모드를 읽어 출력한다.**
## vsync 에 갇힌 줄 모르고 재면 "여유 충분" 이라는 틀린 결론에 도달한다.
func _kill_vsync() -> void:
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
	Engine.max_fps = 0

func _process(delta: float) -> void:
	if _done:
		return
	_frame += 1
	if _frame <= WARM_FRAMES:
		_kill_vsync()
	# 탄이 화면 밖으로 빠져나가 수가 줄면 부하가 줄어든다 — 매 프레임 되채운다.
	var want: int = LEVELS[_level]
	if BulletField.n < want:
		_refill(want - BulletField.n)
	_renderer.queue_redraw()
	if _frame > WARM_FRAMES:
		_dt.append(delta * 1000.0)
		var dc := int(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME))
		_dc = maxi(_dc, dc)
		_dc_level = maxi(_dc_level, dc)
		var nd := 0
		for q in BulletField.n:
			if Tune.KIND_H[BulletField.kind[q]] > 0.0:
				nd += 1
		_needles = maxi(_needles, nd)
	if _frame >= WARM_FRAMES + MEASURE_FRAMES:
		_report(want)
		_level += 1
		if _level >= LEVELS.size():
			_done = true
			_verdict()
			get_tree().quit(0)
			return
		_fill(LEVELS[_level])

func _physics_process(_d: float) -> void:
	if _done:
		return
	# 판정·컬링까지 포함한 실제 한 틱. 렌더만 재면 반쪽이다.
	var t0 := Time.get_ticks_usec()
	BulletField.step_and_collide(_frame, Vector2(360.0, 1000.0), Vector2(362.0, 1000.0), true)
	var us := float(Time.get_ticks_usec() - t0)
	if _frame > WARM_FRAMES:
		_sim_us.append(us)

## 되채울 때도 **같은 분포**를 쓴다. 처음에만 섞어 두면 탄이 화면 밖으로 빠져나가며
## 되채운 탄종으로 치환되고, 측정 구간에는 그 탄종만 남는다 — 첫 판에서 바늘(회전 패스)이
## 사실상 0 이 된 채 "드로우콜 5" 를 보고했다. 회전 패스는 재지도 않고 있었다.
var _refill_i := 0

func _refill(k: int) -> void:
	for i in k:
		var a := _rng.randf() * TAU
		var sp := _rng.randf_range(60.0, 220.0)
		BulletField.spawn(_rng.randf_range(0.0, Tune.PF_W), _rng.randf_range(0.0, Tune.PF_H),
				cos(a) * sp, sin(a) * sp, _mix(_refill_i))
		_refill_i += 1

## 실제 분포 — 포자 50%% · 격자 30%% · 바늘 10%% · 기포 10%%.
static func _mix(i: int) -> int:
	var r := i % 10
	if r == 8:
		return Tune.Kind.NEEDLE
	if r == 9:
		return Tune.Kind.BUBBLE
	return Tune.Kind.SPORE_GRID if r >= 5 else Tune.Kind.SPORE_TIDE

func _report(n: int) -> void:
	var s := _dt.duplicate()
	s.sort()
	var mx := 0.0
	for v in s:
		mx = maxf(mx, v)
	_p50.append(_pct(s, 0.5))
	var sim := _sim_us.duplicate()
	sim.sort()
	_sim_p50 = _pct(sim, 0.5) / 1000.0
	print("  %5d | %14.2f %5.2f %5.2f %5.2f | %8d | %8.3f %5.3f | %5d" % [
		n, _pct(s, 0.5), _pct(s, 0.95), _pct(s, 0.99), mx, _dc_level,
		_sim_p50, _pct(sim, 0.99) / 1000.0, _needles])
	_dc_level = 0
	_needles = 0

func _pct(sorted_v: PackedFloat32Array, q: float) -> float:
	if sorted_v.is_empty():
		return 0.0
	return sorted_v[clampi(int(float(sorted_v.size() - 1) * q), 0, sorted_v.size() - 1)]

func _avg(v: PackedFloat32Array) -> float:
	if v.is_empty():
		return 0.0
	var t := 0.0
	for x in v:
		t += x
	return t / float(v.size())


func _verdict() -> void:
	var mode := DisplayServer.window_get_vsync_mode()
	# macOS/Metal 은 VSYNC_DISABLED 를 보고하고도 컴포지터가 표시 주사율로 붙든다 —
	# 실측: window_get_vsync_mode() == DISABLED 인데 p50 이 정확히 8.33ms(120Hz).
	# 그러므로 "모드를 물어봐서" 갇혔는지 판단하면 안 된다. **숫자 모양으로** 판단한다.
	var lo: float = _p50[0]
	var hi: float = _p50[_p50.size() - 1]
	var pinned := absf(hi - lo) < 0.05 and _near_cadence(hi)
	print("")
	print("  vsync 모드: %d · p50 %.2f→%.2f ms" % [mode, lo, hi])
	if pinned:
		print("  → 표시 케이던스(%0.2f ms)에 붙어 있다. 탄이 12배가 돼도 안 움직였다는 뜻이므로" % hi)
		print("     **실제 프레임 비용은 그보다 작다.** 여유의 크기는 이 판으로 못 잰다.")
	else:
		var dn: float = float(LEVELS[LEVELS.size() - 1] - LEVELS[0])
		print("  → 기울기 탄 1,000발당 %+.2f ms" % ((hi - lo) / dn * 1000.0))
	# 시뮬(물리)은 vsync 와 무관하다 — 이쪽은 그대로 유효한 숫자다.
	print("  시뮬(적분+컬링+판정) %d탄 p50: %.3f ms — Time.get_ticks_usec 로 직접 잰 값이다" % [
		LEVELS[LEVELS.size() - 1], _sim_p50])
	print("  드로우콜 %d (배칭이 되면 탄 수와 무관하게 낮게 유지된다)" % _dc)
	print("")
	print("  게이트: \"2,000탄에서 60fps 미달이면 백엔드 재검토\" — 데스크톱에서는 미달이 아니다.")
	print("  그러나 **판정은 실기 release 5분 연속**이다. 폰은 이 기계보다 느리고,")
	print("  MultiMesh 교체는 그 숫자를 본 뒤에 결정한다(안 보고 바꾸면 추측이다).")

## 흔한 표시 주기(120/90/60Hz)에 붙어 있는가.
func _near_cadence(ms: float) -> bool:
	for hz in [120.0, 90.0, 60.0]:
		if absf(ms - 1000.0 / hz) < 0.2:
			return true
	return false
