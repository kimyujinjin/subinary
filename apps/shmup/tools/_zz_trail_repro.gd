extends Node
## 임시 재현 — 잔광 궤적선(bullet_renderer.gd:94~114)의 역적분 끝점이
## 탄의 **실제 과거 위치**와 얼마나 어긋나는가. 소용돌이 ON/OFF 두 번 돌려 차이를 본다
## (한 번만 재면 전역 조류 이완분·이산화 오차가 섞여 가짜 값이 나온다).

func _ready() -> void:
	var a := _run(true)
	var b := _run(false)
	print("소용돌이 ON  : ", a)
	print("소용돌이 OFF : ", b)
	get_tree().quit()

func _run(vortex: bool) -> String:
	BulletField.clear()
	BulletField.reset_flow()
	var mb := MidBoss.new()
	mb.vortex_on = vortex
	mb.reset(0)
	var player := Vector2(360.0, 1000.0)
	var hist := {}
	var worst := 0.0
	var worst_s := ""
	var sum_err := 0.0
	var n_s := 0
	var over12 := 0
	for t in 1500:
		mb.step(t, player)
		BulletField.step_and_collide(t, player, player, true)
		var seen := {}
		for i in BulletField.n:
			var b: int = BulletField.bid[i]
			seen[b] = true
			var arr: Array = hist.get(b, [])
			arr.append(Vector2(BulletField.pos_x[i], BulletField.pos_y[i]))
			if arr.size() > 20:
				arr.pop_front()
			hist[b] = arr
		for k in hist.keys():
			if not seen.has(k):
				hist.erase(k)
		if t < 100:
			continue
		var c_t := BulletField.flow_c(t)
		var u_max: float = Difficulty.u_max
		for i in BulletField.n:
			var kd: int = BulletField.kind[i]
			var tau: float = Tune.KIND_TAU[kd]
			if tau <= 0.0:
				continue
			var span: float = Tune.KIND_TRAIL[kd]
			var back := span * 60.0
			var arr2: Array = hist[BulletField.bid[i]]
			if float(arr2.size() - 1) < back:
				continue
			var f := float(arr2.size() - 1) - back
			var i0 := int(floor(f))
			var fr := f - float(i0)
			var actual: Vector2 = (arr2[i0] as Vector2).lerp(arr2[i0 + 1] as Vector2, fr)
			var x: float = BulletField.pos_x[i]
			var y: float = BulletField.pos_y[i]
			var vx: float = BulletField.vel_x[i]
			var vy: float = BulletField.vel_y[i]
			var ax := (c_t * BulletField.flow_s(y) * u_max - vx) / tau
			var ex := x - vx * span + 0.5 * ax * span * span
			var ey := y - vy * span
			var err := Vector2(ex, ey).distance_to(actual)
			sum_err += err
			n_s += 1
			if err > 12.0:
				over12 += 1
			if err > worst:
				worst = err
				var dc := Vector2(x, y).distance_to(Vector2(MidBoss.CX, MidBoss.CY))
				worst_s = "t=%d kind=%d d_center=%.0f pos=(%.0f,%.0f) v=(%.0f,%.0f) 오차=%.2f" % [
						t, kd, dc, x, y, vx, vy, err]
	var mean := 0.0 if n_s == 0 else sum_err / float(n_s)
	return "표본 %d · 평균오차 %.2f · 최대 %.2f · >12유닛 %d(%.1f%%) | %s" % [
			n_s, mean, worst, over12, 100.0 * float(over12) / maxf(1.0, float(n_s)), worst_s]
