extends Node
## 회귀 불변식 — 감사에서 확정된 결함이 다시 생기지 않는지 헤드리스로 확인한다.
## 화면을 봐야만 알 수 있던 결함을 숫자로 바꿔 둔다.
##
##   ① 조류 띠 위상의 부호 = 유속의 부호 (tick × c 로 계산하면 램프마다 역주행했다)
##   ② 직침어의 첫 바늘이 생성된 틱을 넘겨 살아남는다 (컬링 경계 밖에서 쏘면 즉사했다)
##   ③ 조류 위상 한 주기 적분 = 0 (flow_phase 의 닫힌형 전제)

var _fail := 0

func _ready() -> void:
	print("== 불변식 ==")
	_flow_phase_sign(false)
	_flow_phase_sign(true)
	_needle_first_shot()
	print("== 실패 %d ==" % _fail)
	get_tree().quit(1 if _fail > 0 else 0)

func _check(ok: bool, label: String) -> void:
	print("  %s %s" % ["OK  " if ok else "FAIL", label])
	if not ok:
		_fail += 1

func _flow_phase_sign(slow: bool) -> void:
	BulletField.flow_slow = slow
	var period: int = Tune.FLOW_SLOW_PERIOD if slow else Tune.FLOW_PERIOD
	var bad := 0
	var bad_old := 0
	for t in period * 3:
		var d := BulletField.flow_phase(t + 1) - BulletField.flow_phase(t)
		var c := BulletField.flow_c(t) + BulletField.flow_c(t + 1)
		if absf(c) > 0.001 and signf(d) != signf(c):
			bad += 1
		# 대조: 옛 공식 tick × c
		var d_old := float(t + 1) * BulletField.flow_c(t + 1) - float(t) * BulletField.flow_c(t)
		if absf(c) > 0.001 and signf(d_old) != signf(c):
			bad_old += 1
	var wrap := absf(BulletField.flow_phase(period) - BulletField.flow_phase(0))
	BulletField.flow_slow = false
	var tag := "감속" if slow else "기본"
	_check(bad == 0, "조류 위상 부호 = 유속 부호 (%s, %d틱 중 역주행 %d · 옛 공식 %d)" % [
		tag, period * 3, bad, bad_old])
	_check(wrap < 0.001, "조류 위상 한 주기 적분 = 0 (%s, 잔차 %.4f)" % [tag, wrap])

func _needle_first_shot() -> void:
	BulletField.clear()
	var ef := EnemyField.new()
	ef.spawn(0, EnemyField.Type.NEEDLEFISH, -60.0, 380.0, 380.0, 0, 0, 1.0)
	var p := Vector2(360.0, 1000.0)
	var first_spawn := -1
	var survived := false
	for t in 240:
		var before := BulletField.n
		ef.step(t, p)
		var spawned := BulletField.n > before
		BulletField.step_and_collide(t, p, p, true)
		if spawned and first_spawn < 0:
			first_spawn = t
			survived = BulletField.n > 0
			break
	_check(first_spawn >= 0 and survived,
		"직침어 첫 바늘이 생성 틱을 넘겨 산다 (첫 발 t=%d, 생존 %s)" % [first_spawn, survived])
