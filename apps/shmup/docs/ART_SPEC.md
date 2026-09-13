# 초상화 규격 — 받아서 덮으면 끝나는 형태

지금 `assets/portraits/` 에 있는 4장은 코드로 구운 **자리표시자**다.
아래 규격에 맞는 PNG 를 **같은 파일명으로 덮으면** 코드 변경 없이 바로 들어간다.
`godot --headless --path . scenes/check_portraits.tscn` 이 규격 위반을 잡아 준다.

## 파일 — **두 종류가 필요하다**

초상화만으로는 부족하다. 초상화는 메뉴와 대사에만 나오고, 플레이하는 5분 동안은
**비행 스프라이트**가 화면에 계속 있다. 이게 없으면 캐릭터 게임인데 정작 게임 중엔
캐릭터가 없다 — 삼각형이 난다.

### 1) 비행 스프라이트 `assets/sprites/` — 플레이 중 계속 보이는 것

| 파일명 | 인물 | 크기 | 프레이밍 |
|---|---|---|---|
| `s0_narin.png` | 나린 | 256×320 (4:5) | 전신, 정면, 물속을 날아가는 자세 |
| `s1_haemu.png` | 해무 | 256×320 (4:5) | 같음 |

- 화면에서 **폭 58유닛**으로 그려진다(플레이필드 720의 8%). 작게 보이므로
  **실루엣과 두 색이 전부다** — 얼굴 디테일은 이 크기에서 안 보인다.
- 몸 **가운데**가 판정 위치다. 그 위에 흰 판정 원(반경 4)과 스침 링(반경 20)이 덮어 그려진다.
  가슴 한가운데를 비워 둘 필요는 없지만, 그 부분에 밝은 디테일을 몰아넣지 말 것.
- 투명 배경. 가장자리 10px 여백.

### 2) 초상화 `assets/portraits/` — 선택 화면과 대사

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

## 이 장르가 캐릭터를 만드는 문법 (동방 프로젝트 참고)

첫 판 프롬프트가 실패한 이유는 **장비만 적었기 때문**이다 — "잠수복, 바이저" 는 복장이지
캐릭터가 아니다. 이 장르가 캐릭터를 캐릭터로 만드는 장치는 따로 있고, 그건 복제가 아니라
문법이라 그대로 쓸 수 있다.

1. **머리 위 표식이 실루엣을 만든다.** 모자·리본·뿔·관 — 이름을 몰라도 실루엣만으로 구분된다.
   얼굴이 작게 나와도 머리 위가 다르면 두 사람이 섞이지 않는다.
2. **한 인물 = 두 색.** 세 색 이상이면 기억되지 않는다. 색 한 쌍이 곧 이름이다.
3. **손에 든 것이 곧 그 인물의 기능이다.** 무엇을 들었는지가 그 사람이 무엇을 하는지를 말한다.
   나린은 넓게 줍고 해무는 좁게 뚫는다 — 그게 손에 보여야 한다.
4. **둘은 성격이 반대다.** 한쪽이 정석·절제라면 다른 쪽은 과감·욕심이다.
   같은 세계의 두 태도이지 상하가 아니다.
5. **정면을 보고 눈을 맞춘다.** 표정이 분명하다. 소극적인 포즈는 이 장르의 초상화가 아니다.
6. **어두운 화면에서 인물이 가장 밝다.** 탄막 배경 위에 얹히므로 인물 자체가 광원처럼 보여야 한다.
   이 게임에서는 그 빛이 생물발광이라 설정과도 맞는다.

**복제하지 않는 것:** 특정 인물의 의장(무녀복·마녀모자·특정 리본 등)·이름·대사·문양.
그건 문법이 아니라 그 작품의 얼굴이고, 가져오면 이 프로젝트의 출발 조건
("완전히 새로운 IP")이 깨져 배포를 못 한다. 위 6개는 장르 공통 문법이라 안전하다.

## 두 조종사 — 반대되는 한 쌍

| | 나린 | 해무 |
|---|---|---|
| 태도 | 과감·욕심. 넓게 훑어 다 줍는다 | 정석·절제. 한 점만 본다 |
| 머리 위 표식 | 넓게 퍼진 **빛 그물 후드** — 테가 넓다 | 곧게 선 **단일 등지느러미 관** — 세로로 높다 |
| 두 색 | 민트(#5AE6D9) + 옅은 금 | 심청(#2A4A8C) + 흰빛 |
| 손에 든 것 | 빛 실로 짠 **채집망**(넓다) | 한 줄짜리 **침 창**(좁다) |
| 발광 무늬 | 어깨·깃을 가로지르는 **가로 줄** | 몸을 따라 내려오는 **세로 줄** |
| 표정 | 웃는 눈, 자신만만 | 다문 입, 흔들리지 않는 눈 |

가로/세로 줄무늬가 사격 폭(넓다/좁다)과 같은 방향이다 — **인물의 무늬가 곧 그 사람의 탄이다.**

## 세계관 — 프롬프트에 반드시 들어가야 하는 것

심해. 빛이 닿지 않는 깊이. 모든 빛은 **생물발광**이다.
게임의 색은 청록(#5AE6D9)과 심청(#081014)이고, 보스만 따뜻한 색(호박·주홍)을 쓴다.
조종사는 잠수 장비를 입고 있다 — 바이저, 호흡관, 발광 표지.

**금지:** 기존 작품의 캐릭터를 닮게 하지 말 것. 무녀복·마녀모자·리본 같은 특정 작품의
상징을 쓰면 이 프로젝트의 출발 조건("완전히 새로운 IP")이 깨지고 배포를 못 한다.
"동방 같은" 은 **구조**(조종사 2명·보스 대사·의장명)를 가리키는 말이지 그림이 아니다.

## 프롬프트 (그대로 붙여 쓸 수 있게)

공통 접미:
`anime character art, bust portrait, facing viewer, direct eye contact, confident expression,
strong silhouette, transparent background, 768x1024, no text, no watermark, no logo,
clean edges, character is the brightest element, dark teal background tone #081014`

### s0_narin — 나린 비행 스프라이트
```
Anime game sprite, full body, front view, young woman floating and flying through
deep water, seen small — readable by silhouette alone at 58px wide.
Signature: a WIDE translucent hood fanning out like a light-catching net, broad brim.
Two colors only: bright mint (#5AE6D9) and pale gold. HORIZONTAL glowing stripes.
She holds a wide glowing net in one hand, arms open and relaxed, hair and hood
trailing upward in the current. Glowing from within. 256x320, transparent background,
no background elements, clean edges.
```

### s1_haemu — 해무 비행 스프라이트
```
Anime game sprite, full body, front view, young woman diving forward through black water,
seen small — readable by silhouette alone at 58px wide.
Signature: a TALL narrow dorsal crest rising straight up from the helm, a single vertical fin.
Two colors only: deep navy (#2A4A8C) and white light. VERTICAL glowing lines down the suit.
She holds a single slender needle-lance pointed forward, body compact and streamlined,
arms close to the body. Glowing from within. 256x320, transparent background,
no background elements, clean edges.
```

### p0_narin — 나린 (넓게 보고 멀리 줍는다)
```
Anime character art, bust portrait of Narin, a bold young WOMAN, deep-sea scout.
Signature headwear: a WIDE translucent hood that fans out like a light-catching net,
broad brim silhouette — instantly readable from her outline alone.
Two-color identity: bright mint (#5AE6D9) and pale gold, nothing else.
She holds a wide gathering net woven from glowing threads, spread open in one hand.
HORIZONTAL bioluminescent stripes run across her collar and shoulders.
Grinning eyes, cocky and greedy for light. She is the brightest thing in frame,
glowing from within like a deep-sea organism. Transparent background.
```

### p1_haemu — 해무 (좁게 보고 깊게 뚫는다)
```
Anime character art, bust portrait of Haemu, a disciplined young WOMAN, deep-diving pilot.
Signature headwear: a TALL narrow dorsal crest rising straight up from the helm,
a single vertical fin — a thin sharp silhouette, the opposite of Narin's wide brim.
Two-color identity: deep navy (#2A4A8C) and white light, nothing else.
Holds a single slender needle-lance upright, one line, no spread.
VERTICAL bioluminescent lines run down the suit from shoulder to waist.
Closed mouth, unwavering narrow gaze, utterly still. Glowing from within.
Transparent background.
```

### p2_tersa — 조류 방추체 테르사 (중간보스 · 물을 돌린다)
```
Bioluminescent deep-sea creature, not human. A vertical spindle body, three times
taller than wide, tapered at both ends, drifting upright in black water.
Amber and warm gold light spirals around it, and the spiral direction is clearly
readable — the water turns where it turns. Faint rotating current lines around the body.
No face, no limbs. Ominous, patient. Brightest element in frame. Transparent background.
```

### p3_corona — 화륜종 코로나 (최종보스 · 조류의 출처)
```
Bioluminescent deep-sea creature, not human. A dark sphere that contains light:
an almost-black core silhouette with three concentric glowing rings rotating around it,
like a bell holding a flame inside. Warm vermilion and amber light leaking between
the rings. Vast, still, older than the current itself. No face, no limbs.
Brightest element in frame. Transparent background.
```

**어느 프롬프트에도 특정 작품의 인물·의장·이름을 넣지 않는다.** 생성물이 기존 캐릭터를
닮아 보이면 다시 뽑는다 — 닮은 그림 한 장이 이 프로젝트 전체의 배포를 막는다.

## 받은 뒤

1. 초상화는 `assets/portraits/`, 비행 스프라이트는 `assets/sprites/` 에 같은 이름으로 덮는다.
2. `godot --headless --path . --import` 한 번.
3. `godot --headless --path . scenes/check_portraits.tscn` — 규격 위반이 있으면 알려준다.
4. `godot --path . scenes/portrait_preview.tscn` — 실제 화면에서 어떻게 보이는지 본다.
