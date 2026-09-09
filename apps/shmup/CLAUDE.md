# apps/shmup — LUMEN DRIFT

Godot 4.7.2 · GDScript 전면 정적 타입 · 이 저장소의 pnpm/turbo 파이프라인과 완전 독립.

## 규약 3줄 — 어기면 조용히 깨진다

1. **탄은 노드가 아니라 배열 인덱스다.** BulletField 가 SoA Packed 배열로 전체 탄을 소유한다.
   프레임 중 append/remove_at 금지, 제거는 swap-with-last.
2. **Resource 는 런타임 읽기 전용이다.** `load()` 는 경로당 한 인스턴스를 돌려주므로
   `def.hp -= dmg` 한 줄이 그 적 타입 전체를 오염시킨다. duplicate() 도 답이 아니다.
   가변 상태는 전부 별도 SoA.
3. **apps/shmup 에 package.json 을 절대 만들지 않는다.** 생기는 순간 turbo/pnpm 에 편입되어
   "빌드 완전 독립" 확정사항이 무효가 된다.

## 게이트 3줄

- **게이트 1 통과 전에는** 패턴 4종째·기체 2종째·난이도 2단째·MultiMesh·셰이더·Resource·
  UI 화면·사운드를 만들지 않는다.
- **판정은 실기 release 빌드에서만 유효하다.** 에디터(debug) 실행은 1.6~1.9배 느리다.
- **성능은 추측하지 않는다.** 탄 루프가 실기 release 에서 4ms 를 넘길 때까지 백엔드 논의 없음.

## 결정론

모든 게임 로직은 `_physics_process` 안, `dt` 는 인자가 아니라 `const DT := 1.0/60.0`.
게임 시간은 우리 소유의 `sim_tick: int`. `Engine.time_scale` · `await create_timer()` ·
`Tween` · `Timer` 를 시뮬에 쓰지 않는다.
