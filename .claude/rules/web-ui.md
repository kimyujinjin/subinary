---
paths:
  - "apps/web/**"
---

# 웹 UI 규칙

- 가계부 거래 상세는 화면 폭과 상관없이 하단 시트로 띄운다(`DialogContent layout="sheet"`) — 사용자 결정, PC·태블릿에서 가운데 대화상자로 떠서 지적받음(2026-11-05). `dialog.test.ts`가 고정한다.
