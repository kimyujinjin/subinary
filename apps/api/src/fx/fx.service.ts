import { BadRequestException, Injectable } from '@nestjs/common';
import type { FxReference } from '@family/contracts';
import { EcbHistoricalFxProvider, fxBaseDate } from '@family/transaction-domain';

const LOOKBACK_DAYS = 7;

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 화면 표시용 최근 기준환율(자산 화면의 외화 보유 원화 환산).
 *
 * ECB는 주말·휴일 값이 없어 최근 영업일까지 거슬러 찾는다. 조회 결과는 제공자가 캐시하고
 * 여기서는 DB에 저장하지 않는다 — 거래 금액 계약(fx_rate_snapshots)과 섞지 않기 위해서다.
 */
@Injectable()
export class FxService {
  private readonly provider = new EcbHistoricalFxProvider();

  async reference(base: string | undefined): Promise<FxReference> {
    if (base !== 'USD') throw new BadRequestException('지원하지 않는 통화예요.');
    const now = new Date();
    let date = fxBaseDate(now, now);
    for (let i = 0; i < LOOKBACK_DAYS; i += 1, date = shiftDate(date, -1)) {
      const result = await this.provider.lookup(base, date);
      if (result.status === 'available') {
        return { baseCurrency: 'USD', quoteCurrency: 'KRW', rate: result.rate, asOfDate: date, source: 'ecb-reference' };
      }
      if (result.reason !== 'observation_missing') break;
    }
    return { baseCurrency: 'USD', quoteCurrency: 'KRW', rate: null, asOfDate: null, source: 'ecb-reference' };
  }
}
