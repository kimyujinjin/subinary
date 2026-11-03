# ATTRIBUTIONS

## 현재 상태 — 외부 애셋 1종(폰트)

이 게임은 완전히 새로운 IP다. 기존 작품의 캐릭터·세계관·음악·스테이지·탄막 패턴·UI·그래픽을
복제하지 않는다. 탄·적·보스·배경·화면·사운드는 전부 코드에서 만든다
(절차적 도형 + `_draw()` + 기동 시 구운 PCM).

**"이미지 애셋 0개" 는 더 이상 사실이 아니다.** 캐릭터를 넣기로 하면서 두 가지가 들어왔다:
- **폰트 1종** — 대사·인물 이름이 한글이라 필요하다. 유일한 외부 저작물이다(아래 고지).
- **초상화 4장** — 코드로 구운 자리표시자이고 외부 저작물이 아니다.

## 엔진

Godot Engine 4.7.2-stable — MIT License. https://godotengine.org

## 추가 시 기록 규칙

애셋을 추가하는 커밋은 반드시 이 파일을 같은 커밋에서 갱신한다.
허용: CC0 · MIT · 직접 생성물. **금지: CC-BY-SA · GPL.**

## 폰트 — Pretendard (SIL Open Font License 1.1)

`assets/fonts/Pretendard-subset.ttf` 는 Pretendard Regular 를 **이 게임 화면에 실제로
나오는 글자만** 남겨 서브셋한 것이다(1.5MB → 114KB). 서브셋도 원본과 같은 라이선스다.

- 이름: Pretendard
- 저작자: Kil Hyung-jin (길형진) 및 기여자
- 라이선스: SIL Open Font License, Version 1.1
- 원본: https://github.com/orioncactus/pretendard

**해결됨(2026-09-13).** OFL 1.1 은 폰트(파생 서브셋 포함)를 배포할 때 라이선스 **전문**을
함께 싣도록 요구한다.

- `assets/fonts/OFL.txt` — 원본 저장소의 라이선스 전문(Kil Hyung-jin · Adobe Source 고지 포함)
- `export_presets.cfg` 의 `include_filter` 에 넣어 **APK/IPA 안에 실제로 들어간다.**
  `.txt` 는 Godot 이 리소스로 임포트하지 않으므로 이 필터가 없으면 조용히 빠진다
- 설정 → `FONT LICENSE` 에서 전문을 페이지로 읽을 수 있다. 이 화면만 **내장 폰트**로
  그린다 — Pretendard 는 화면에 나오는 글자만 남긴 서브셋이라 전문의 기호가 서브셋
  밖이면 통째로 빈칸이 되고, **빈칸으로 나오는 라이선스는 동봉하지 않은 것과 같다**

## 초상화 — 자리표시자

`assets/portraits/p0..p3.png` 는 `tools/bake_portraits.gd` 가 코드로 구운 것이다.
외부 저작물이 아니며, 진짜 그림으로 교체할 자리다.
