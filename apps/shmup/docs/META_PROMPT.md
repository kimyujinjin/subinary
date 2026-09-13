# 메타프롬프트 — Nano Banana 로 이 게임의 그림 전부 뽑기

받아서 넣으면 끝나게 되어 있다. 배경 투명은 **안 뽑아도 된다** —
평평한 마젠타 배경으로 받아서 `scenes/key_art.tscn` 이 알파로 바꾼다.

---

## 0. 먼저 이것부터 (모델에게 한 번만 붙여넣는 세계관 고정)

> **WORLD BIBLE — paste once at the start of the session, then keep referring back to it.**
>
> Setting: the deep sea, below the reach of sunlight. **Every visible light is bioluminescence
> coming from inside a living thing** — there are no lamps, no sun, no fire.
> The water itself moves: a slow horizontal current that reverses every few seconds.
> Creatures here read that current to survive.
>
> Palette law (do not break):
> - Background void: near-black deep navy `#081014`
> - Player side / safe light: cyan-mint `#5AE6D9`
> - Enemy bullets and hostile light: coral red `#F0655F`
> - Bosses only: warm amber / vermilion `#E8A13C`, `#E05A32`
> - Never use green foliage, warm sunlight, gold ornament, or fire.
>
> Style law: anime game art, clean readable silhouettes, strong rim light from within,
> no outlines thicker than the glow, no text, no logos, no signatures, no watermark.
>
> **Originality law (critical):** this is a brand-new IP. Do not reproduce the costume,
> insignia, hairstyle-plus-outfit combination, or named look of any existing game or anime
> character. No shrine-maiden robes, no witch hats, no recognizable school uniforms.
> If an output resembles an existing character, regenerate it.
>
> Output law: **flat solid magenta background `#FF00FF`, absolutely uniform, no gradient,
> no shadow cast onto it, no magenta anywhere on the subject.** The subject must not touch
> the image border — leave at least 5% empty margin on all four sides.

---

## 1. 템플릿 (새 대상이 생기면 이 빈칸만 채운다)

```
[WORLD BIBLE applies.]
{SHOT}: {SUBJECT_ONE_LINE}.
Silhouette anchor: {SILHOUETTE}.
Two colors only: {COLOR_A} and {COLOR_B}.
Signature detail: {SIGNATURE}.
Light: glows from within, {GLOW_PATTERN}.
Reads at {TARGET_PX}px — {READABILITY_NOTE}.
Flat solid magenta #FF00FF background. {ASPECT}.
```

빈칸의 뜻:
- `SHOT` — `Full body front view game sprite` / `Bust portrait, facing viewer, direct eye contact`
- `SILHOUETTE` — 실루엣만으로 구분되게 하는 **머리 위 또는 외곽 형태** 한 가지
- `TARGET_PX` — 화면에서 실제로 그려지는 폭. 이게 디테일 밀도를 정한다
- `READABILITY_NOTE` — 그 크기에서 무엇이 보여야 하는가

---

## 2. 뽑을 목록 — 13장

| # | 파일 | 비율 | 화면 표시 폭 | 용도 |
|---|---|---|---|---|
| 1 | `sprites/s0_narin.png` | 4:5 | 58px | 플레이 중 계속 |
| 2 | `sprites/s1_haemu.png` | 4:5 | 58px | 플레이 중 계속 |
| 3 | `portraits/p0_narin.png` | 3:4 | 160~390px | 선택·대사 |
| 4 | `portraits/p1_haemu.png` | 3:4 | 160~390px | 선택·대사 |
| 5 | `portraits/p2_tersa.png` | 3:4 | 390px | 중간보스 대사 |
| 6 | `portraits/p3_corona.png` | 3:4 | 390px | 보스 대사 |
| 7~13 | `enemies/e0..e6.png` | 1:1 | 36~68px | 적 7종(선택) |

7~13 은 선택이다 — 지금은 절차적 도형으로 잘 돌아가고, 적은 **실루엣이 곧 경고**라
그림이 오히려 읽기를 방해할 수 있다. 넣는다면 지금 도형의 실루엣을 유지해야 한다.

---

## 3. 조종사 — 두 사람은 **반대**여야 한다

성별이 같으므로(둘 다 여성) 구분은 전부 실루엣·색·무늬가 한다.
무늬 방향이 그 사람의 사격 폭과 같다 — 가로줄은 넓게 쏘고, 세로줄은 한 줄로 쏜다.

### 1. s0_narin — 나린 비행 스프라이트
```
[WORLD BIBLE applies.]
Full body front view game sprite: a bold young woman, deep-sea scout, floating upright
and drifting forward through black water.
Silhouette anchor: a WIDE translucent hood that fans out flat above her head like a
light-catching net — a broad horizontal brim, unmistakable from the outline alone.
Two colors only: mint #5AE6D9 and pale gold.
Signature detail: she holds a wide gathering net woven from glowing threads, spread open
in one hand; her other arm is relaxed and open. Hood and hair trail upward in the current.
Light: glows from within, HORIZONTAL glowing stripes across collar and shoulders.
Reads at 58px — only the wide brim, the open arms and the horizontal stripes need to survive.
Flat solid magenta #FF00FF background. 4:5 portrait aspect (e.g. 1024x1280).
```

### 2. s1_haemu — 해무 비행 스프라이트
```
[WORLD BIBLE applies.]
Full body front view game sprite: a disciplined young woman, deep diver, body compact and
streamlined, diving forward through black water.
Silhouette anchor: a TALL narrow dorsal crest rising straight up from her helm — a single
vertical fin, the exact opposite of Narin's wide brim.
Two colors only: deep navy #2A4A8C and white light.
Signature detail: she holds one slender needle-lance upright and forward, arms held close
to the body, nothing spread.
Light: glows from within, VERTICAL glowing lines running down the suit from shoulder to waist.
Reads at 58px — only the tall crest, the closed compact body and the vertical lines need to survive.
Flat solid magenta #FF00FF background. 4:5 portrait aspect (e.g. 1024x1280).
```

### 3. p0_narin — 나린 초상화
```
[WORLD BIBLE applies.]
Bust portrait, facing viewer, direct eye contact, chest up: the same bold young woman from
the Narin sprite — keep the wide fanned hood, the mint and pale gold, the horizontal stripes.
Expression: grinning eyes, cocky, greedy for light.
Light: glows from within; she is the brightest object in frame.
Reads at 390px — now the face carries it, but the wide hood must still define the silhouette.
Flat solid magenta #FF00FF background. 3:4 aspect (e.g. 768x1024).
```

### 4. p1_haemu — 해무 초상화
```
[WORLD BIBLE applies.]
Bust portrait, facing viewer, direct eye contact, chest up: the same disciplined young woman
from the Haemu sprite — keep the tall narrow crest, the deep navy and white, the vertical lines.
Expression: closed mouth, unwavering narrow gaze, utterly still.
Light: glows from within; she is the brightest object in frame.
Reads at 390px — the face carries it, but the tall crest must still define the silhouette.
Flat solid magenta #FF00FF background. 3:4 aspect (e.g. 768x1024).
```

## 4. 보스 — 인물이 아니라 **생물**이다. 얼굴을 만들지 말 것

### 5. p2_tersa — 조류 방추체 테르사 (중간보스)
```
[WORLD BIBLE applies.]
Bioluminescent deep-sea creature, NOT humanoid, no face, no limbs.
A vertical spindle body, three times taller than wide, smoothly tapered at both ends,
hanging upright in black water.
Silhouette anchor: the spindle itself — a single clean vertical shuttle shape.
Two colors only: warm amber #E8A13C and deep navy void.
Signature detail: glowing stripes SPIRAL around the body, and the direction of the spiral
is clearly readable — the water turns where it turns. Faint rotating current lines around it.
Light: glows from within, patient and slow.
Reads at 390px — the spiral direction must be unmistakable.
Flat solid magenta #FF00FF background. 3:4 aspect.
```

### 6. p3_corona — 화륜종 코로나 (최종보스)
```
[WORLD BIBLE applies.]
Bioluminescent deep-sea creature, NOT humanoid, no face, no limbs.
A dark sphere that CONTAINS light: an almost-black core with three concentric glowing rings
rotating around it at different tilts, like a bell holding a flame inside.
Silhouette anchor: the three rings around a black centre.
Two colors only: vermilion #E05A32 and amber #E8A13C, leaking between the rings.
Signature detail: the core is darker than the background — it reads as a hole, not an object.
Light: light escapes only between the rings.
Reads at 390px — vast, still, older than the current itself.
Flat solid magenta #FF00FF background. 3:4 aspect.
```

## 5. 적 7종 (선택) — **실루엣이 곧 경고**다

적은 "무엇을 강요하는 적인가" 를 실루엣으로 말해야 한다. 지금 도형이 그 역할을 하고 있으므로,
그림을 넣으려면 **그 실루엣을 유지**해야 한다. 크기가 작아 디테일은 전부 사라진다.

| 파일 | 이름 | 가르치는 것 | 유지할 실루엣 |
|---|---|---|---|
| `e0.png` | 표류 포자체 | 물이 흐른다 | 둥근 포자낭, 부드러운 원 |
| `e1.png` | 침어 | 쏘기 전에 미리 흘러갈 것 | 가늘고 긴 수평 바늘 |
| `e2.png` | 관 해파리 | 화면 하단을 떠날 것 | 종 모양 갓 + 늘어진 관 |
| `e3.png` | 부착 발광관 | 수평 방향을 한쪽으로 확정할 것 | 고정된 수직 관, 위가 벌어짐 |
| `e4.png` | 광낭충 | 미래 화면을 위해 지금 자리를 잡을 것 | 마디 있는 애벌레, 주머니가 매달림 |
| `e5.png` | 군체 등해파리 코어 | 표적 우선순위 | 중심 구체 + 공전 궤도 흔적 |
| `e6.png` | 역류 뱀장어 | 화면 아래를 존중할 것 | 아래에서 솟는 긴 뱀 형태 |

각각 이 템플릿으로:
```
[WORLD BIBLE applies.]
Top-down view of a small bioluminescent deep-sea creature, seen from above as the player
sees it. {이름 + 유지할 실루엣}.
Two colors only: coral red #F0655F glow on a near-black body.
Light: glows from within along the body.
Reads at {36~68}px — the silhouette alone must communicate "{가르치는 것}".
No face, no eyes. Flat solid magenta #FF00FF background. 1:1 square.
```

## 6. Nano Banana 로 돌리는 절차

1. **세계관을 먼저 붙여넣는다**(§0). 그 세션 내내 유지된다.
2. **조종사는 스프라이트를 먼저** 뽑는다. 마음에 드는 한 장이 나오면, 그 이미지를 다시
   첨부하고 이렇게 말한다:
   > `Same character, same hood, same colors, same stripes. Now a bust portrait,
   > chest up, facing viewer, 3:4 aspect, flat magenta background.`
   Nano Banana 의 캐릭터 일관성이 여기서 일한다 — 프롬프트만으로 다시 뽑으면 다른 사람이 된다.
3. 배경이 완전히 균일하지 않으면 이렇게 고친다:
   > `Keep the character exactly as is. Replace the background with a single flat
   > #FF00FF magenta, no gradient, no shadow, no glow spill onto the background.`
4. 인물이 잘렸으면:
   > `Zoom out. Leave 8% empty margin on all four sides. Do not crop any part of the character.`
5. 기존 캐릭터를 닮았으면 **다시 뽑는다**. 닮은 그림 한 장이 배포를 막는다.

## 7. 받은 뒤 — 내 쪽에서 처리된다

```bash
# 1) 받은 파일을 아무 이름으로 raw/ 에 둔다
apps/shmup/assets/raw/s0_narin.png   (매젠타 배경 그대로, 크기 아무거나)

# 2) 키잉 + 리사이즈 + 배치
godot --headless --path . scenes/key_art.tscn

# 3) 규격 검사
godot --headless --path . scenes/check_portraits.tscn

# 4) 화면에서 확인
godot --path . scenes/portrait_preview.tscn
```

`key_art` 가 하는 일: 마젠타를 알파로 빼고, 가장자리 마젠타 번짐을 정리하고,
규격 크기로 리샘플하고, 여백을 확보해 `assets/portraits/` · `assets/sprites/` 에 넣는다.
