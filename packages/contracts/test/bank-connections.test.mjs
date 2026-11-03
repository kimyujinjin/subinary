import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bankConnectionRegisterSchema, bankConnectionSchema, assetConnectionCatalogSchema, shinhanDepositCaptureSchema, bankCaptureMatchesSelector, BANK_CONNECTION_CONSENT_VERSION, bankConnectionConsentDocuments } from '../dist/index.mjs';
const uuid=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const registration=()=>({householdId:uuid(1),connectionId:uuid(2),provider:'shinhan_bank',loginId:'synthetic-id',password:'Synthetic!123',
 selector:{accountLast4:'1234',loanType:'interim'},consentVersion:BANK_CONNECTION_CONSENT_VERSION,consent:{ownAccount:true,storeCredentials:true,automaticLogin:true,refreshOnOpen:true}});
test('stored bank login requires own-account, encryption storage and automatic-login consent separately',()=>{
 assert.equal(bankConnectionRegisterSchema.safeParse(registration()).success,true);
 for(const field of Object.keys(registration().consent)){ const value=registration();value.consent[field]=false;assert.equal(bankConnectionRegisterSchema.safeParse(value).success,false,field); }
 assert.equal(bankConnectionConsentDocuments[BANK_CONNECTION_CONSENT_VERSION].length,4);
 for(const consentVersion of [undefined,0,3,'1'])assert.equal(bankConnectionRegisterSchema.safeParse({...registration(),consentVersion}).success,false);
});
test('existing version-one loan grants stay valid but never authorize deposits',()=>{
 assert.equal(bankConnectionRegisterSchema.safeParse({...registration(),consentVersion:1}).success,true);
 const deposit={...registration(),selector:{accountType:'deposit',accountLast4:'1234'}};
 assert.equal(bankConnectionRegisterSchema.safeParse(deposit).success,true);
 assert.equal(bankConnectionRegisterSchema.safeParse({...deposit,consentVersion:1}).success,false);
 assert.match(bankConnectionConsentDocuments[1][3],/앱을 닫아 둔 동안에는 조회하지/);
 assert.match(bankConnectionConsentDocuments[2][2],/통장의 원화 잔액/);
});
test('deposit observation keeps exact signed KRW ledger balances and rejects extra private fields',()=>{
 const base={formatVersion:1,provider:'shinhan',source:'browser_assisted',origin:'https://bank.shinhan.com',pageKind:'deposit_account_list',capturedAt:'2026-11-03T00:00:00.000Z',accountFingerprint:'a'.repeat(64),accountLast4:'1234',currency:'KRW',balanceKind:'ledger',balanceKrw:'0',bankAsOfDate:null};
 for(const balanceKrw of ['0','9007199254740993','-12345'])assert.equal(shinhanDepositCaptureSchema.parse({...base,balanceKrw}).balanceKrw,balanceKrw);
 for(const change of [{balanceKrw:'-0'},{balanceKrw:'1.2'},{balanceKrw:'12\n'},{currency:'USD'},{balanceKind:'withdrawable'},{accountNumber:'SYNTHETIC_ONLY'},{bankAsOfDate:'2026-11-03'}])assert.equal(shinhanDepositCaptureSchema.safeParse({...base,...change}).success,false);
 assert.equal(bankCaptureMatchesSelector({accountType:'deposit',accountLast4:'1234'},base),true);
 assert.equal(bankCaptureMatchesSelector({loanType:'interim',accountLast4:'1234'},base),false);
 assert.equal(bankCaptureMatchesSelector({accountType:'deposit',accountLast4:'5678'},base),false);
});
test('unverified institutions never accept credentials through the verified bank route',()=>{
 for(const provider of ['kb_bank','toss_bank','toss_securities','unknown']) assert.equal(bankConnectionRegisterSchema.safeParse({...registration(),provider}).success,false);
 for(const value of [{...registration(),url:'https://evil.invalid'}, {...registration(),selector:{accountLast4:'123456789012',loanType:'interim'}}, {...registration(),password:'bad\npassword'}]) assert.equal(bankConnectionRegisterSchema.safeParse(value).success,false);
 for(const field of ['loginId','password'])for(const end of ['\n','\r','\r\n']){
  const value=registration();value[field]+=end;assert.equal(bankConnectionRegisterSchema.safeParse(value).success,false);
 }
});
test('bank response is strictly secret-free and cannot silently enter household totals',()=>{
 const instant='2026-11-02T00:00:00.000Z';
 const value={id:uuid(2),householdId:uuid(1),ownerUserId:uuid(3),provider:'shinhan_bank',version:1,status:'stored',selector:registration().selector,
 visibility:'owner_only',includedInTotals:false,refreshOnOpen:true,credentialsStored:true,consentVersion:BANK_CONNECTION_CONSENT_VERSION,consentedAt:instant,lastAttemptAt:null,lastSuccessAt:null,nextRefreshAt:null,canRefresh:true,errorCode:null,snapshot:null,createdAt:instant,updatedAt:instant};
 assert.equal(bankConnectionSchema.safeParse(value).success,true);
 for(const change of [{password:'PRIVATE_FIXTURE'},{loginId:'synthetic-id'},{credentials:{ciphertext:'sealed'}},{visibility:'household'},{includedInTotals:true}]) assert.equal(bankConnectionSchema.safeParse({...value,...change}).success,false);
});
test('capabilities separate real readiness from placeholders',()=>{
 const item={provider:'shinhan_bank',method:'web_login',credentialInputAvailable:false,state:'runtime_required'};
 assert.equal(assetConnectionCatalogSchema.safeParse({items:[item]}).success,false);
});
