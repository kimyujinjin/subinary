class_name MoteField
## 광립 — 조류 독해를 아이템 동선으로 재교육하는 드롭. SoA.
##
## 위로 부상하고 2.0초 뒤 기체를 향해 이동한다. 설계서 §7:
## 오프셋 상대 드래그는 기체를 화면 중상단에 놓으므로 아래로 떨어지는 드롭은 구조적으로
## 멀어진다. 원안의 "상단 y<420 으로 올라가 진공 회수" 는 y=1100 → 400 이 손가락 67mm
## 상방 이동인데 엄지의 편안한 상방 신장이 30~40mm 라 파지 변경 없이 불가능하다.
##
## 회수 판정은 히트박스가 아니라 graze 링(20유닛)이다.

var xs := PackedFloat32Array()
var ys := PackedFloat32Array()
var vxs := PackedFloat32Array()
var vys := PackedFloat32Array()
var born := PackedInt32Array()
var n: int = 0

var collected: int = 0        ## 이번 틱에 회수된 개수 — 호출자가 점수로 바꾼다

func _init() -> void:
	xs.resize(Tune.MAX_MOTES); ys.resize(Tune.MAX_MOTES)
	vxs.resize(Tune.MAX_MOTES); vys.resize(Tune.MAX_MOTES)
	born.resize(Tune.MAX_MOTES)

func clear() -> void:
	n = 0
	collected = 0

func spawn(tick: int, x: float, y: float) -> void:
	if n >= Tune.MAX_MOTES:
		return
	xs[n] = x; ys[n] = y
	vxs[n] = 0.0; vys[n] = -Tune.MOTE_RISE
	born[n] = tick
	n += 1

## 조류를 100% 탄다(광립도 물에 실린다) → 회수 동선이 곧 조류 독해 연습이다.
func step(tick: int, player: Vector2) -> void:
	collected = 0
	var relax := Tune.DT / float(Tune.KIND_TAU[Tune.Kind.SPORE_TIDE])
	# 회수 반경은 조종사마다 다르다 — 나린의 보상이다.
	# 판정 반경이 아니라 graze 링을 쓰는 이유는 그대로다: 회수가 사망 원인이 되면 안 된다.
	var pr: float = Cast.pickup_r()
	var r2: float = pr * pr
	var i := 0
	while i < n:
		var age := tick - born[i]
		if age >= Tune.MOTE_HOME_DELAY:
			var d := player - Vector2(xs[i], ys[i])
			var l := d.length()
			if l > 0.001:
				vxs[i] = d.x / l * Tune.MOTE_HOME_SPEED
				vys[i] = d.y / l * Tune.MOTE_HOME_SPEED
		else:
			var u := BulletField.flow_u(ys[i], tick)
			vxs[i] += (u - vxs[i]) * relax
		xs[i] += vxs[i] * Tune.DT
		ys[i] += vys[i] * Tune.DT
		var dx := xs[i] - player.x
		var dy := ys[i] - player.y
		if dx * dx + dy * dy <= r2:
			collected += 1
			_remove(i)
			continue
		if age > Tune.MOTE_LIFE or ys[i] < -40.0 or xs[i] < -60.0 or xs[i] > Tune.PF_W + 60.0:
			_remove(i)
			continue
		i += 1

func _remove(i: int) -> void:
	n -= 1
	xs[i] = xs[n]; ys[i] = ys[n]
	vxs[i] = vxs[n]; vys[i] = vys[n]
	born[i] = born[n]
