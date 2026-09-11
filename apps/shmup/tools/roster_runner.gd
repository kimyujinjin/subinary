extends Node
## 적 7종 로스터 검사 — 각 적이 **실제로 자기 패턴을 쏘는지**, 언제 퇴장하는지.
##
## 적을 추가하고 타임라인에 올리기 전에 여기서 본다. 스테이지에 넣고 나서야
## "쏘지 않는다 / 안 나간다 / 즉시 사라진다" 를 발견하면 공정성 수치가 통째로 헛것이 된다
## (P02 를 그렇게 겪었다 — 패턴을 넣었는데 탄이 플레이어 밴드에 닿지도 않았다).

const TICKS := 1200

var _fail := 0

func _ready() -> void:
	print("== 적 로스터 ==")
	print("  적                 첫 탄   총 탄  최대동시  퇴장t  종료y   판정")
	_run("표류 포자체", EnemyField.Type.DRIFTER, 360.0, -50.0, 230.0, 0, 224, 0.0)
	_run("침어", EnemyField.Type.NEEDLEFISH, -60.0, 380.0, 380.0, 24, EnemyField.NF_HOLD, 1.0)
	_run("관 해파리", EnemyField.Type.MEDUSA, 360.0, -50.0, 440.0, 0, 300, 0.0)
	_run("부착 발광관", EnemyField.Type.TUBE, 360.0, -50.0, 210.0, 0, 340, 0.0)
	_run("광낭충", EnemyField.Type.PODWORM, 360.0, -50.0, 0.0, 0, 720, 0.0)
	_run("역류 뱀장어", EnemyField.Type.EEL, 360.0, Tune.PF_H + 60.0, 0.0, 0, 600, 0.0)
	_run_colony()
	print("== 실패 %d ==" % _fail)
	get_tree().quit(1 if _fail > 0 else 0)

func _run(label: String, kind: int, x: float, y: float, hold_y: float,
		m: int, hold: int, dx: float) -> void:
	var ef := EnemyField.new()
	ef.spawn(0, kind, x, y, hold_y, m, hold, dx)
	_measure(label, ef)

func _run_colony() -> void:
	var ef := EnemyField.new()
	ef.spawn_colony(0, 360.0, 260.0, 700)
	_measure("군체 등해파리", ef)

func _measure(label: String, ef: EnemyField) -> void:
	BulletField.clear()
	var p := Vector2(360.0, 1000.0)
	var first := -1
	var total := 0
	var peak := 0
	var gone := -1
	var last_y := 0.0
	for t in TICKS:
		var before := BulletField.n
		ef.step(t, p)
		if BulletField.n > before:
			total += BulletField.n - before
			if first < 0:
				first = t
		BulletField.step_and_collide(t, p, p, true)
		peak = maxi(peak, BulletField.n)
		if ef.n > 0:
			last_y = ef.py[0]
		elif gone < 0:
			gone = t
	var ok := first >= 0 and total > 0 and gone >= 0
	var why := PackedStringArray()
	if first < 0:
		why.append("FAIL:발사0")
	if gone < 0:
		why.append("FAIL:퇴장없음")
	if first >= 0 and first > 300:
		why.append("느린첫탄")
	print("  %-16s %5s %6d %8d %6s %6.0f   %s" % [
		label, "-" if first < 0 else str(first), total, peak,
		"-" if gone < 0 else str(gone), last_y,
		"OK" if ok else " ".join(why)])
	if not ok:
		_fail += 1
	BulletField.clear()
