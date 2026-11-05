/**
 * 날짜·시간 입력 칸(`<input type="datetime-local">`)의 시간대 안내.
 *
 * 입력 칸은 브라우저가 이 기기의 시간대로 읽고 쓴다. 그런데 목록·상세의 시각은 한국 시간(Asia/Seoul)으로 보인다.
 * 해외에 있을 때(폰 시간대가 바뀌었을 때) 상세에는 '오후 2:31'인데 칸에는 12:31이 들어 있어서,
 * 칸을 '바로잡아' 저장하면 실제 시각이 밀리고 월말이면 다른 달 합계로 넘어간다.
 * 예전 칸 이름 '(이 기기의 시간)'이 하던 일을, 시간대가 다를 때만 칸 아래 한 줄로 대신한다.
 */

/** 한국 시간은 일광 절약 시간이 없어 언제나 UTC+9다. `getTimezoneOffset`은 (UTC − 현지)라 부호가 반대다. */
const SEOUL_TIMEZONE_OFFSET_MINUTES = -9 * 60;

/** 기기 시간대가 한국과 다를 때 날짜·시간 칸 아래에 붙이는 한 줄. */
export const DEVICE_TIME_ZONE_NOTE =
  "지금 기기 시간대가 한국과 달라요. 이 칸은 기기 시간 기준이고, 다른 화면의 시각은 한국 시간이에요.";

/**
 * 그 순간 이 기기의 시각이 한국 시간과 같은지. 시간대 이름(Asia/Seoul·Asia/Pyongyang 같은 별칭)이 아니라
 * 그 순간의 오프셋으로 판정한다 — 일광 절약 시간이 있는 곳이면 날짜마다 다를 수 있어서 거래 시각을 넘긴다.
 * 잘못된 날짜면 지금 시각으로 본다.
 */
export function deviceMatchesSeoulTime(at: Date = new Date()): boolean {
  const instant = Number.isNaN(at.getTime()) ? new Date() : at;
  return instant.getTimezoneOffset() === SEOUL_TIMEZONE_OFFSET_MINUTES;
}
