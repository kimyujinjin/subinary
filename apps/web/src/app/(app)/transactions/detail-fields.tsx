/**
 * 거래 상세의 정보·설정 줄(`FieldList`·`FieldRow`)은 카드 수정 창 같은 다른 화면도 쓰도록
 * 2026-11-05 HIG 검수 3·4단계에서 `components/widgets/field-row.tsx`로 옮겼다.
 * 기존 import가 깨지지 않게 그대로 다시 내보낸다. 새 코드는 `@/components/widgets`에서 가져온다.
 */
export {
  FieldList,
  FieldRow,
  type FieldRowProps,
} from "@/components/widgets/field-row";
