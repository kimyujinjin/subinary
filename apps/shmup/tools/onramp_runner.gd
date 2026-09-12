extends Node
## 첫 10초 온램프 측정. 실기 25판 중 9판이 9~11초에 죽었다 — P01 첫 교사의 볼리
## 잔여와 첫 직침어가 겹치는 구간이다. "한 번에 새 문법 하나" 원칙으로 두 손잡이를 잰다:
##   · 첫 교사의 hold(= 볼리 수. 볼리 66틱 간격이므로 hold 가 볼리 수를 정한다)
##   · 첫 직침어 진입 틱
## 지표: 플레이어 영역(y 860~1256)의 탄 수 — 피크와 9~11초 평균, 그리고 그 구간의
## P01 잔여 탄 수(직침어가 들어올 때 화면에 남아 있는 포자). 자탄 없음(최악 케이스).

const ZONE_Y0 := 860.0
const ZONE_Y1 := 1256.0

func _ready() -> void:
	print("== 온램프 (자탄 없음 · 최악) ==")
	print("  hold 볼리  직침t | 영역피크(t)   9~11s평균  직침진입시 P01잔여  첫바늘t")
	for hold in [420, 290, 224]:
		for nf in [560, 640, 720]:
			var r := _run(hold, nf)
			print("  %4d  %d   %4d | %4d(t%-4d)  %6.1f      %4d            %4d" % [
				hold, _volleys(hold), nf, r[0], r[1], r[2], r[3], r[4]])
	get_tree().quit(0)

## hold 가 허용하는 볼리 수. 패턴 자체의 상한(P01_VOLLEYS)으로 캡된다.
func _volleys(hold: int) -> int:
	var v := int(floor(float(hold - 1) / float(Patterns.P01_VOLLEY_TICKS))) + 1
	return mini(v, Patterns.P01_VOLLEYS)

func _run(hold: int, nf_tick: int) -> Array:
	BulletField.clear()
	var waves: Array = Stage.WAVES.duplicate(true)
	waves[0][5] = hold
	waves[1][0] = nf_tick
	var ef := EnemyField.new()
	var p := Vector2(360.0, 1000.0)
	var cursor := 0
	var peak := 0
	var peak_t := 0
	var sum := 0
	var cnt := 0
	var residual := -1
	var first_needle := -1
	for t in 900:
		while cursor < waves.size() and int(waves[cursor][0]) <= t:
			var w: Array = waves[cursor]
			ef.spawn_wave(t, w)
			cursor += 1
		var before := BulletField.n
		ef.step(t, p)
		BulletField.step_and_collide(t, p, p, true)
		var zone := 0
		var tide := 0
		for i in BulletField.n:
			var y: float = BulletField.pos_y[i]
			if y >= ZONE_Y0 and y <= ZONE_Y1:
				zone += 1
			if BulletField.kind[i] == Tune.Kind.SPORE_TIDE and y < ZONE_Y1:
				tide += 1
		if first_needle < 0:
			for i in BulletField.n:
				if BulletField.kind[i] == Tune.Kind.NEEDLE:
					first_needle = t
					break
		if first_needle == t:
			residual = tide
		if zone > peak:
			peak = zone
			peak_t = t
		if t >= 540 and t < 660:
			sum += zone
			cnt += 1
	return [peak, peak_t, float(sum) / float(maxi(cnt, 1)), residual, first_needle]
