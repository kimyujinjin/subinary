class_name Audio
## 사운드 — **파일 0개.** 기동 시 코드에서 PCM 을 구워 AudioStreamWAV 로 만든다.
##
## 이 저장소는 그림·음악 제작이 불가능하다는 조건에서 출발했다(설계서 §10). rFXGen 으로
## 8종을 뽑아 넣는 대신 같은 종류의 소리를 합성한다 — "이미지 애셋 0개" 와 같은 이유로
## "오디오 애셋 0개" 를 유지하면 저작권·용량·ATTRIBUTIONS 문제가 통째로 사라진다.
##
## 매 프레임 합성하지 않는다(AudioStreamGenerator 를 쓰면 GDScript 가 버퍼를 채워야 한다).
## 기동 때 한 번 구워 두고 재생만 한다 — 런타임 비용은 일반 재생과 같다.
##
## 게이트: **소리를 완전히 끄고도 정확히 플레이되는가**(설계서 §11 8단계).
## 그래서 모든 소리는 화면에 이미 있는 신호의 **중복**이다. 소리만 있는 정보는 없다.

enum Sfx { GRAZE, HIT, BOMB, KILL, MOTE, PHASE, CLEAR, RESCUE }
const SFX_N := 8
const RATE := 22050
const VOICES := 8               ## 동시 발성 — 넘치면 가장 오래된 것을 뺏는다

static var _ready_done := false
static var _enabled := true
static var _streams: Array[AudioStreamWAV] = []
static var _players: Array[AudioStreamPlayer] = []
static var _music: AudioStreamPlayer = null
static var _next: int = 0
static var _bus_sfx: int = -1
static var _bus_mus: int = -1

## 버스 3개 — Master · SFX · MUSIC. 설정에서 끄는 것은 두 자식 버스의 mute 다.
## root 는 **씬 트리의 루트**에 붙인다(root.get_tree().root). main 의 자식으로 붙이면
## 장면 전환(_switch_scene)에서 main 과 함께 해제되는데 static 배열은 그대로 들고 있어
## 다음 재생에서 해제된 노드를 건드린다 — 전역 상태가 씬 수명에 묶이면 안 된다.
static func setup(node: Node) -> void:
	if _ready_done:
		return
	var tree := node.get_tree()
	var root: Node = tree.root if tree != null else node
	_ready_done = true
	_bus_sfx = _make_bus(root, "SFX")
	_bus_mus = _make_bus(root, "MUSIC")
	_streams.resize(SFX_N)
	for i in SFX_N:
		_streams[i] = _bake(i)
	# **call_deferred 로 붙인다.** main._ready 안에서 트리 루트에 직접 add_child 하면
	# 루트가 자식 설정 중이라 실패한다 — 실기 로그가 정확히 그렇게 말했다:
	#   "Parent node is busy setting up children, add_child() failed" ×4
	#   "Playback can only happen when a node is inside the scene tree"
	# 즉 폰에서 **소리가 통째로 안 났다.** 데스크톱 러너는 러너 _ready 에서 부르는데
	# 그때는 루트가 한가해서 통과했다 — 실기에서만 깨지는 부류다.
	for i in VOICES:
		var p := AudioStreamPlayer.new()
		p.bus = "SFX"
		root.add_child.call_deferred(p)
		_players.append(p)
	_music = AudioStreamPlayer.new()
	_music.bus = "MUSIC"
	_music.stream = _bake_music()
	root.add_child.call_deferred(_music)

static func _make_bus(_root: Node, name_: String) -> int:
	var idx := AudioServer.get_bus_index(name_)
	if idx >= 0:
		return idx
	idx = AudioServer.bus_count
	AudioServer.add_bus(idx)
	AudioServer.set_bus_name(idx, name_)
	AudioServer.set_bus_send(idx, "Master")
	return idx

## static 이 스트림을 프로세스 종료까지 붙들면 Godot 이 "leaked instances" 로 경고한다.
## 실제 누수는 아니지만 그 경고가 상시 켜져 있으면 **진짜 누수를 못 본다** — 신호를 지킨다.
## 종료 직전에 부른다(러너는 quit 앞에서, 게임은 창을 닫을 때).
static func teardown() -> void:
	# 재생 중인 것을 먼저 멈춘다. 오디오 서버가 재생 객체를 들고 있는 동안 노드를 해제하면
	# 그 playback 이 종료까지 남아 "leaked" 로 잡힌다.
	for p in _players:
		if is_instance_valid(p) and p.playing:
			p.stop()
	if _music != null and is_instance_valid(_music) and _music.playing:
		_music.stop()
	for p in _players:
		if is_instance_valid(p):
			p.stream = null
			p.free()   # 종료 직전이므로 지연 해제를 기다리지 않는다
	_players.clear()
	if _music != null and is_instance_valid(_music):
		_music.stream = null
		_music.free()
	_music = null
	_streams.clear()
	_ready_done = false

static func set_enabled(on: bool) -> void:
	_enabled = on
	if _bus_sfx >= 0:
		AudioServer.set_bus_mute(_bus_sfx, not on)
	if _bus_mus >= 0:
		AudioServer.set_bus_mute(_bus_mus, not on)

static func play(id: int) -> void:
	if not _enabled or not _ready_done or id < 0 or id >= SFX_N:
		return
	if _players.is_empty():
		return
	var p: AudioStreamPlayer = _players[_next]
	# 아직 트리에 안 들어갔을 수 있다(call_deferred). 들어가기 전에 play() 하면
	# "Playback can only happen when a node is inside the scene tree" 로 에러만 쌓인다.
	if not is_instance_valid(p) or not p.is_inside_tree():
		return
	_next = (_next + 1) % VOICES
	p.stream = _streams[id]
	p.play()

static func music(on: bool) -> void:
	if _music == null or not is_instance_valid(_music) or not _music.is_inside_tree():
		return
	if on and not _music.playing:
		_music.play()
	elif not on and _music.playing:
		_music.stop()

## ── 합성 ────────────────────────────────────────────────────────────────
## 소리 하나하나가 화면의 어떤 신호를 중복하는지 주석에 적는다 —
## 중복이 아닌 소리를 하나라도 넣는 순간 "소리를 꺼도 정확히 플레이된다" 가 깨진다.
static func _bake(id: int) -> AudioStreamWAV:
	match id:
		Sfx.GRAZE:   # 스침 링이 번쩍이는 것과 같은 사건. 아주 짧고 높다
			return _tone(0.05, 1400.0, 1800.0, 0.18, 0.0)
		Sfx.HIT:     # 피격 — 화면 플래시와 히트스톱의 중복
			return _tone(0.26, 220.0, 70.0, 0.55, 0.5)
		Sfx.BOMB:
			return _tone(0.45, 90.0, 40.0, 0.60, 0.7)
		Sfx.KILL:    # 격파 — 광립이 터져 나오는 것의 중복
			return _tone(0.16, 500.0, 900.0, 0.30, 0.25)
		Sfx.MOTE:    # 회수 — 점수 증가의 중복
			return _tone(0.07, 900.0, 1350.0, 0.16, 0.0)
		Sfx.PHASE:   # 페이즈 전환 — 고리 점등과 P15 의 중복
			return _tone(0.60, 160.0, 320.0, 0.40, 0.15)
		Sfx.CLEAR:
			return _tone(0.90, 330.0, 660.0, 0.42, 0.1)
		_:           # RESCUE — 구제 창. 실기 로그가 "창이 열린 것을 알리는 채널" 을 요구했다
			return _tone(0.18, 660.0, 990.0, 0.45, 0.0)

## 지수 감쇠 사인 + 노이즈. from→to 로 피치가 미끄러진다.
static func _tone(sec: float, f0: float, f1: float, amp: float, noise: float) -> AudioStreamWAV:
	var n := int(RATE * sec)
	var buf := PackedByteArray()
	buf.resize(n * 2)
	var ph := 0.0
	var seed := 12345
	for i in n:
		var t := float(i) / float(n)
		var f: float = lerpf(f0, f1, t)
		ph += TAU * f / float(RATE)
		var env: float = exp(-4.0 * t)
		# 결정론적 노이즈 — RNG 인스턴스를 들지 않는다(같은 빌드는 같은 소리여야 한다)
		seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
		var nz := (float(seed % 2048) / 1024.0 - 1.0) * noise
		var v: float = clampf((sin(ph) * (1.0 - noise) + nz) * env * amp, -1.0, 1.0)
		var s := int(v * 32000.0)
		buf[i * 2] = s & 0xFF
		buf[i * 2 + 1] = (s >> 8) & 0xFF
	var w := AudioStreamWAV.new()
	w.format = AudioStreamWAV.FORMAT_16_BITS
	w.mix_rate = RATE
	w.stereo = false
	w.data = buf
	return w

## 루프 트랙 1개 — 심해 드론. 두 배음의 느린 맥놀이다.
## 멜로디가 없는 이유: 5분 내내 도는 트랙에 멜로디가 있으면 먼저 지겨워지고,
## 이 게임의 리듬은 조류(8초 주기)가 이미 만들고 있다.
static func _bake_music() -> AudioStreamWAV:
	var sec := 8.0
	var n := int(RATE * sec)
	var buf := PackedByteArray()
	buf.resize(n * 2)
	for i in n:
		var t := float(i) / float(RATE)
		# 55Hz 기음 + 82.5Hz(완전5도). 0.125Hz 로 천천히 숨 쉰다 — 조류 주기(8초)와 같다.
		var breath := 0.55 + 0.45 * sin(TAU * t / sec)
		var v := (sin(TAU * 55.0 * t) * 0.5 + sin(TAU * 82.5 * t) * 0.3
				+ sin(TAU * 110.0 * t) * 0.12) * 0.22 * breath
		var s := int(clampf(v, -1.0, 1.0) * 32000.0)
		buf[i * 2] = s & 0xFF
		buf[i * 2 + 1] = (s >> 8) & 0xFF
	var w := AudioStreamWAV.new()
	w.format = AudioStreamWAV.FORMAT_16_BITS
	w.mix_rate = RATE
	w.stereo = false
	w.data = buf
	w.loop_mode = AudioStreamWAV.LOOP_FORWARD
	w.loop_begin = 0
	w.loop_end = n
	return w
