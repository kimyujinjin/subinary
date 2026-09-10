class_name Replay
## 사망 교재용 링버퍼. 0.5초(30틱)를 되감아 "무엇에 죽었는지"와
## "있어야 했던 틈이 어디였는지"를 같은 화면에서 보여준다.
##
## 자동 봄을 넣지 않는 이유가 이것이다 — 자동 봄은 죽음의 원인을 흐리고,
## 이 게임의 사망 화면은 교재다.
##
## 탄 인덱스는 swap-remove 로 재배정되므로 하이라이트는 bid 로 추적한다.
##
## 속도·틱까지 저장하는 이유: 교재의 탄을 실시간과 **같은 텍스처·회전·잔광**으로
## 그리기 위해서다. 평면 원으로 따로 그렸더니 사망 순간 탄의 외형이 바뀌고
## (바늘은 판정 반폭 1.5유닛 점이 됐다) 실시간 레이어와 겹쳐 두 벌로 보였다.

var xs := PackedFloat32Array()
var ys := PackedFloat32Array()
var vxs := PackedFloat32Array()
var vys := PackedFloat32Array()
var kinds := PackedInt32Array()
var bids := PackedInt32Array()
var _cnt := PackedInt32Array()
var _tick := PackedInt32Array()
var _px := PackedFloat32Array()
var _py := PackedFloat32Array()
var _nx0 := PackedInt32Array()      # 플레이어가 속한(또는 가장 가까운) 통로
var _nw := PackedInt32Array()       # 0 = 밴드에 탄이 없어 통로가 정의되지 않는다
var _head: int = 0          # 다음에 쓸 슬롯
var _filled: int = 0

func _init() -> void:
	var cap := Tune.REPLAY_TICKS * Tune.REPLAY_MAX
	xs.resize(cap); ys.resize(cap); vxs.resize(cap); vys.resize(cap)
	kinds.resize(cap); bids.resize(cap)
	_cnt.resize(Tune.REPLAY_TICKS); _tick.resize(Tune.REPLAY_TICKS)
	_px.resize(Tune.REPLAY_TICKS); _py.resize(Tune.REPLAY_TICKS)
	_nx0.resize(Tune.REPLAY_TICKS); _nw.resize(Tune.REPLAY_TICKS)

func clear() -> void:
	_head = 0
	_filled = 0

func record(bf: Node, player: Vector2, tick: int, near_x0: int, near_w: int) -> void:
	var slot := _head
	var base := slot * Tune.REPLAY_MAX
	var m: int = mini(bf.n, Tune.REPLAY_MAX)
	for i in m:
		xs[base + i] = bf.pos_x[i]
		ys[base + i] = bf.pos_y[i]
		vxs[base + i] = bf.vel_x[i]
		vys[base + i] = bf.vel_y[i]
		kinds[base + i] = bf.kind[i]
		bids[base + i] = bf.bid[i]
	_cnt[slot] = m
	_tick[slot] = tick
	_px[slot] = player.x
	_py[slot] = player.y
	_nx0[slot] = near_x0
	_nw[slot] = near_w
	_head = (slot + 1) % Tune.REPLAY_TICKS
	if _filled < Tune.REPLAY_TICKS:
		_filled += 1

func length() -> int:
	return _filled

## step: 0 = 가장 오래된 프레임
func slot_at(step: int) -> int:
	return (_head - _filled + step + Tune.REPLAY_TICKS * 2) % Tune.REPLAY_TICKS

func base_of(step: int) -> int:
	return slot_at(step) * Tune.REPLAY_MAX

func frame_count(step: int) -> int:
	return _cnt[slot_at(step)]

func frame_tick(step: int) -> int:
	return _tick[slot_at(step)]

func frame_player(step: int) -> Vector2:
	var s := slot_at(step)
	return Vector2(_px[s], _py[s])

## 있어야 했던 틈 = 그 프레임에 플레이어가 속한(또는 가장 가까운) 통로.
## 최장 구간을 쓰면 통로가 여러 개일 때 프레임 사이에 A→B 로 순간이동한다.
func frame_gap(step: int) -> Vector2i:
	var s := slot_at(step)
	return Vector2i(_nx0[s], _nw[s])

func bullet_at(step: int, i: int) -> Vector2:
	var b := base_of(step) + i
	return Vector2(xs[b], ys[b])

func bullet_bid(step: int, i: int) -> int:
	return bids[base_of(step) + i]
