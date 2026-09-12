extends Node
## 반증용 임시 러너 — vy≈0 탄의 영구 잔류 주장을 재현한다.

func _dump(label: String) -> void:
	var perm := 0
	var minx := 1e9
	var maxx := -1e9
	for i in BulletField.n:
		if absf(BulletField.vel_y[i]) < 1.0:
			perm += 1
		minx = minf(minx, BulletField.pos_x[i])
		maxx = maxf(maxx, BulletField.pos_x[i])
	print("%s  n=%d  vy<1 인 탄=%d  x범위=[%.1f, %.1f]" % [label, BulletField.n, perm, minx, maxx])

func _ready() -> void:
	Difficulty.apply(Difficulty.Level.NORMAL)
	var p := Vector2(360.0, Tune.PF_H * 0.8)

	# ── A. p15 1회만
	BulletField.clear()
	BulletField.reset_flow()
	Patterns.p15(360.0, 320.0, p.x, p.y)
	print("A) p15(360,320) 직후 n=%d" % BulletField.n)
	for i in BulletField.n:
		if absf(BulletField.vel_y[i]) < 1.0:
			print("   초기 vy≈0 탄: x=%.2f y=%.2f vx=%.2f vy=%.8f kind=%d" % [
				BulletField.pos_x[i], BulletField.pos_y[i],
				BulletField.vel_x[i], BulletField.vel_y[i], BulletField.kind[i]])
	for t in 18000:
		BulletField.step_and_collide(t, p, p, true)
		if (t + 1) % 3000 == 0:
			_dump("   t=%5d" % (t + 1))
	for i in BulletField.n:
		print("   남은 탄: x=%.2f y=%.4f vx=%.2f vy=%.8f kind=%d" % [
			BulletField.pos_x[i], BulletField.pos_y[i],
			BulletField.vel_x[i], BulletField.vel_y[i], BulletField.kind[i]])

	# ── B. 중간보스 전체 1회 + 이후 6000틱
	for on in [true, false]:
		BulletField.clear()
		BulletField.reset_flow()
		var mb := MidBoss.new()
		mb.vortex_on = on
		mb.reset(0)
		var t2 := 0
		while t2 < 4000 and not mb.done:
			mb.step(t2, p)
			BulletField.step_and_collide(t2, p, p, true)
			t2 += 1
		print("B) 소용돌이=%s 격파 t=%d" % [str(on), t2])
		BulletField.vortex_w = 0.0
		_dump("   격파 직후")
		for t3 in 6000:
			BulletField.step_and_collide(t2 + t3, p, p, true)
		_dump("   +6000틱")
		for i in BulletField.n:
			print("     x=%.2f y=%.2f vx=%.2f vy=%.8f kind=%d" % [
				BulletField.pos_x[i], BulletField.pos_y[i],
				BulletField.vel_x[i], BulletField.vel_y[i], BulletField.kind[i]])
	get_tree().quit(0)
