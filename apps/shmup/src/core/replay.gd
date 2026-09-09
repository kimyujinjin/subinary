class_name Replay
## 사망 교재용 링버퍼. 0.5초(30틱)를 되감아 "무엇에 죽었는지"와
## "있어야 했던 틈이 어디였는지"를 같은 화면에서 보여준다.
##
## 자동 봄을 넣지 않는 이유가 이것이다 — 자동 봄은 죽음의 원인을 흐리고,
## 이 게임의 사망 화면은 교재다.
##
## 탄 인덱스는 swap-remove 로 재배정되므로 하이라이트는 bid 로 추적한다.

var _x := PackedFloat32Array()
var _y := PackedFloat32Array()
var _kind := PackedByteArray()
var _bid := PackedInt32Array()
var _cnt := PackedInt32Array()
var _px := PackedFloat32Array()
var _py := PackedFloat32Array()
var _gx0 := PackedInt32Array()
var _gw := PackedInt32Array()
var _head: int = 0          # 다음에 쓸 슬롯
var _filled: int = 0

func _init() -> void:
	var cap := Tune.REPLAY_TICKS * Tune.REPLAY_MAX
	_x.resize(cap); _y.resize(cap); _kind.resize(cap); _bid.resize(cap)
	_cnt.resize(Tune.REPLAY_TICKS)
	_px.resize(Tune.REPLAY_TICKS); _py.resize(Tune.REPLAY_TICKS)
	_gx0.resize(Tune.REPLAY_TICKS); _gw.resize(Tune.REPLAY_TICKS)

func clear() -> void:
	_head = 0
	_filled = 0

func record(bf: Node, player: Vector2, gx0: int, gw: int) -> void:
	var slot := _head
	var base := slot * Tune.REPLAY_MAX
	var m: int = mini(bf.n, Tune.REPLAY_MAX)
	for i in m:
		_x[base + i] = bf.pos_x[i]
		_y[base + i] = bf.pos_y[i]
		_kind[base + i] = bf.kind[i]
		_bid[base + i] = bf.bid[i]
	_cnt[slot] = m
	_px[slot] = player.x
	_py[slot] = player.y
	_gx0[slot] = gx0
	_gw[slot] = gw
	_head = (slot + 1) % Tune.REPLAY_TICKS
	if _filled < Tune.REPLAY_TICKS:
		_filled += 1

func length() -> int:
	return _filled

## step: 0 = 가장 오래된 프레임
func slot_at(step: int) -> int:
	return (_head - _filled + step + Tune.REPLAY_TICKS * 2) % Tune.REPLAY_TICKS

func frame_count(step: int) -> int:
	return _cnt[slot_at(step)]

func frame_player(step: int) -> Vector2:
	var s := slot_at(step)
	return Vector2(_px[s], _py[s])

func frame_gap(step: int) -> Vector2i:
	var s := slot_at(step)
	return Vector2i(_gx0[s], _gw[s])

func bullet_at(step: int, i: int) -> Vector3:
	var base := slot_at(step) * Tune.REPLAY_MAX + i
	return Vector3(_x[base], _y[base], float(_kind[base]))

func bullet_bid(step: int, i: int) -> int:
	return _bid[slot_at(step) * Tune.REPLAY_MAX + i]
