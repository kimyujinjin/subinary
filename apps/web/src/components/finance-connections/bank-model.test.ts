import { describe, expect, it } from 'vitest';
import type { BankConnection } from '@family/contracts';
import { reconcileBankOperation } from './bank-model';
const row=(status:BankConnection['status'],version=2)=>({id:'known',status,version} as BankConnection);
describe('bank request reconciliation',()=>{
  it('reconciles stored registration without starting another bank login',()=>{
    expect(reconcileBankOperation({id:'known',kind:'register',version:0},[row('stored')])).toBeNull();
  });
  it('keeps an unknown refresh locked until a later terminal state is observed',()=>{
    const pending={id:'known',kind:'refresh',version:2} as const;
    expect(reconcileBankOperation(pending,[row('refreshing',3)])).toBe(pending);
    expect(reconcileBankOperation(pending,[row('ready',2)])).toBe(pending);
    expect(reconcileBankOperation(pending,[row('ready',4)])).toBeNull();
  });
  it('never treats a missing registration or failed disconnection as success',()=>{
    const registration={id:'unknown',kind:'register',version:0} as const;
    expect(reconcileBankOperation(registration,[])).toBe(registration);
    const disconnect={id:'known',kind:'disconnect',version:2} as const;
    expect(reconcileBankOperation(disconnect,[row('ready',3)])).toBe(disconnect);
    expect(reconcileBankOperation(disconnect,[row('disconnected',3)])).toBeNull();
  });
});
