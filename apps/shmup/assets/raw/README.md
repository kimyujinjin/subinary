# raw — AI 에서 받은 원본을 여기에 둔다

규격 파일명 그대로 두면 된다(크기·비율은 아무래도 좋다):
`p0_narin.png` `p1_haemu.png` `p2_tersa.png` `p3_corona.png` `s0_narin.png` `s1_haemu.png`

배경은 **평평한 마젠타 `#FF00FF`** 로 받는다 — Nano Banana 는 투명 배경을 안 준다.
`godot --headless --path . scenes/key_art.tscn` 이 알파로 바꾸고 규격에 맞춰 배치한다.
잘라내지 않고 여백을 붙여 맞추므로 비율이 달라도 받은 그림 그대로 들어간다.

프롬프트는 `docs/META_PROMPT.md` 에 있다.

이 폴더에는 `.gdignore` 가 있다 — Godot 이 아예 임포트하지 않는다.
없으면 1024×1024 원본 12장이 APK 에 통째로 들어가 **10MB 를 먹는다**(실측: 27MB → 37MB).
게임이 쓰는 것은 `assets/portraits/` · `assets/sprites/` · `assets/enemies/` 의 리샘플본뿐이다.
