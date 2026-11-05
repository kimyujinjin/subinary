/**
 * 앱 이름 글자 로고 — 앱 안 헤더의 '모아'(app/(app)/layout.tsx BrandMark)와 같은 글꼴 굵기·자간·색.
 * 로그인·가입 화면 가운데에 홀로 서므로 한 단계 크게(display) 둔다. 예전에는 신용카드 아이콘이라 앱 이름이 없었다.
 */
export function BrandWordmark() {
  return (
    <p className="text-primary text-display font-extrabold tracking-[-0.07em]">
      모아
    </p>
  );
}
