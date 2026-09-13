# 초상화 규격 — 받아서 덮으면 끝나는 형태

지금 `assets/portraits/` 에 있는 4장은 코드로 구운 **자리표시자**다.
아래 규격에 맞는 PNG 를 **같은 파일명으로 덮으면** 코드 변경 없이 바로 들어간다.
`godot --headless --path . scenes/check_portraits.tscn` 이 규격 위반을 잡아 준다.

## 파일

| 파일명 | 인물 | 정체 |
|---|---|---|
| `p0_narin.png` | 나린 | 조종사. 표층 정찰. "넓게 보고 멀리 줍는다" |
| `p1_haemu.png` | 해무 | 조종사. 심해 잠항. "좁게 보고 깊게 뚫는다" |
| `p2_tersa.png` | 조류 방추체 테르사 | 중간보스. 물을 돌리는 존재 |
| `p3_corona.png` | 화륜종 코로나 | 최종보스. 조류의 출처 |

## 규격

- **크기 768 × 1024** (3:4). 더 커도 되지만 비율은 3:4 를 지킨다.
  다른 비율도 잘리지 않고 들어가지만 위아래 여백이 생긴다.
- **배경 투명**(알파 채널 필수). 배경을 칠하면 화면의 심해 배경을 가린다.
- **반신** — 가슴 위. 얼굴이 위쪽 40% 안에 들어오게. 아래쪽 15%는 글상자에 물린다.
- 인물이 **화면 안쪽(가운데)을 향하게**. 정면도 괜찮다.
- 가장자리에서 **20px 이상 띄운다**(모바일 텍스처 압축이 가장자리를 물어뜯는다).

## 세계관 — 프롬프트에 반드시 들어가야 하는 것

심해. 빛이 닿지 않는 깊이. 모든 빛은 **생물발광**이다.
게임의 색은 청록(#5AE6D9)과 심청(#081014)이고, 보스만 따뜻한 색(호박·주홍)을 쓴다.
조종사는 잠수 장비를 입고 있다 — 바이저, 호흡관, 발광 표지.

**금지:** 기존 작품의 캐릭터를 닮게 하지 말 것. 무녀복·마녀모자·리본 같은 특정 작품의
상징을 쓰면 이 프로젝트의 출발 조건("완전히 새로운 IP")이 깨지고 배포를 못 한다.
"동방 같은" 은 **구조**(조종사 2명·보스 대사·의장명)를 가리키는 말이지 그림이 아니다.

## 프롬프트 (그대로 붙여 쓸 수 있게)

공통 접미: `anime style character art, bust portrait, facing viewer, transparent background,
768x1024, no text, no watermark, clean edges, bioluminescent deep sea theme, dark teal palette`

### p0_narin — 나린
```
Anime style bust portrait of a young deep-sea scout pilot named Narin.
Wide-shouldered light diving suit, open-face visor pushed up on the forehead,
short pale-mint hair, calm observant expression. Broad horizontal bioluminescent
stripes glowing cyan across the suit collar and shoulders — she reads the current
by watching wide. Cool teal and cyan palette (#5AE6D9) against deep navy (#081014).
Soft internal glow, no external light source. Transparent background.
```

### p1_haemu — 해무
```
Anime style bust portrait of a deep-diving pilot named Haemu.
Narrow sealed diving suit with a closed visor, breathing line along the jaw,
long dark hair tied back, focused narrow gaze. Thin vertical bioluminescent lines
glowing pale blue run down the suit — he/she reads the current by looking deep and narrow.
Colder blue palette than Narin. Deep navy background tone (#081014), transparent background.
```

### p2_tersa — 조류 방추체 테르사
```
Bioluminescent deep-sea creature, not human. A vertical spindle-shaped body about
three times taller than wide, smooth and tapered at both ends, drifting upright.
Amber and warm-gold glowing stripes spiral around the body, and the spiral direction
is visible — the water turns where it turns. Faint rotating current visible around it.
Dark, moody, no face. Transparent background.
```

### p3_corona — 화륜종 코로나
```
Bioluminescent deep-sea creature, not human. A dark sphere that contains light:
an almost-black core silhouette with three concentric glowing rings rotating around it,
like a bell holding a flame. Warm vermilion and amber light leaking between the rings.
Vast, still, older than the current. No face, no limbs. Transparent background.
```

## 받은 뒤

1. `assets/portraits/` 에 같은 이름으로 덮는다.
2. `godot --headless --path . --import` 한 번.
3. `godot --headless --path . scenes/check_portraits.tscn` — 규격 위반이 있으면 알려준다.
4. `godot --path . scenes/portrait_preview.tscn` — 실제 화면에서 어떻게 보이는지 본다.
