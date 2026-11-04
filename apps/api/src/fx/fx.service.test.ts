import { describe, expect, it } from 'vitest';
import { FxService } from './fx.service';

type Lookup = (base: string, date: string) => Promise<unknown>;
function serviceWith(lookup: Lookup): { service: FxService; dates: string[] } {
  const dates: string[] = [];
  const service = new FxService();
  (service as unknown as { provider: { lookup: Lookup } }).provider = {
    lookup: (base, date) => { dates.push(date); return lookup(base, date); },
  };
  return { service, dates };
}

describe('FxService.reference', () => {
  it('walks back over days without an ECB observation', async () => {
    let calls = 0;
    const { service, dates } = serviceWith(async () => (++calls < 3
      ? { status: 'unavailable', reason: 'observation_missing' }
      : { status: 'available', rate: '1380.5', origin: {} }));
    const result = await service.reference('USD');
    expect(result.rate).toBe('1380.5');
    expect(result.asOfDate).toBe(dates[2]);
    expect(dates[0] > dates[1] && dates[1] > dates[2]).toBe(true);
  });

  it('returns null instead of a made-up rate when the provider fails', async () => {
    const { service, dates } = serviceWith(async () => ({ status: 'unavailable', reason: 'network_error' }));
    expect(await service.reference('USD')).toMatchObject({ rate: null, asOfDate: null });
    expect(dates).toHaveLength(1);
  });

  it('rejects unsupported currencies', async () => {
    const { service } = serviceWith(async () => ({ status: 'unavailable', reason: 'network_error' }));
    await expect(service.reference('JPY')).rejects.toThrow();
  });
});
