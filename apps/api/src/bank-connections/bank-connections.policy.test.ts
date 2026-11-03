import { describe, expect, it } from 'vitest';
import { BANK_REFRESH_INTERVAL_MS, bankLoginFingerprint, projectBankState } from './bank-connections.policy';

const now=Date.parse('2026-11-02T00:00:00.000Z');
const base=()=>({status:'ready',disconnectedAt:null,operationId:null,operationStartedAt:null,lastAttemptAt:null,credentials:{sealed:true},errorCode:null,version:1});
describe('bank login operation policy',()=>{
  it('never starts a provider read from disabled or missing credentials',()=>{
    expect(projectBankState(base(),true,now).canRefresh).toBe(true);
    expect(projectBankState(base(),false,now).canRefresh).toBe(false);
    expect(projectBankState({...base(),credentials:null},true,now).canRefresh).toBe(false);
  });
  it('enforces the 15 minute boundary exactly',()=>{
    const row={...base(),lastAttemptAt:new Date(now-BANK_REFRESH_INTERVAL_MS+1)};
    expect(projectBankState(row,true,now).canRefresh).toBe(false);
    expect(projectBankState(row,true,now+1).canRefresh).toBe(true);
  });
  it.each(['credentials_invalid','authentication_required','unsupported_layout','account_ambiguous','account_changed','operation_unknown'])('does not automatically retry %s',errorCode=>{
    expect(projectBankState({...base(),status:'error',errorCode},true,now).canRefresh).toBe(false);
  });
  it('projects an expired operation as uncertain without releasing its durable claim',()=>{
    const row={...base(),status:'refreshing',operationId:'synthetic-op',operationStartedAt:new Date(now-90000)};
    const result=projectBankState(row,true,now);
    expect(result.errorCode).toBe('operation_unknown');expect(result.canRefresh).toBe(false);expect(row.operationId).toBe('synthetic-op');
  });
  it('keeps disconnection and the integer version ceiling effective',()=>{
    expect(projectBankState({...base(),disconnectedAt:new Date(now)},true,now).canRefresh).toBe(false);
    expect(projectBankState({...base(),version:2147483646},true,now).canRefresh).toBe(false);
    expect(projectBankState({...base(),version:2147483645},true,now).canRefresh).toBe(true);
  });
  it('serializes login IDs conservatively while keeping passwords out of the key',()=>{
    expect(bankLoginFingerprint('Synthetic-ID')).toBe(bankLoginFingerprint('synthetic-id'));
    expect(bankLoginFingerprint('synthetic-id')).not.toBe(bankLoginFingerprint('other-id'));
  });
});
