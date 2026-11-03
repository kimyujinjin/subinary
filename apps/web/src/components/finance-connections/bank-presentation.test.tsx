import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { bankConnectionSchema, type BankConnection } from '@family/contracts';
import { BankConnectionCard } from './bank-screen';
import { BankRegistrationForm } from './bank-registration-form';
const instant='2026-11-03T00:00:00.000Z';
const uuid=(n:number)=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const deposit=(balance:string|null):BankConnection=>bankConnectionSchema.parse({id:uuid(1),householdId:uuid(2),ownerUserId:uuid(3),provider:'shinhan_bank',version:1,status:balance===null?'stored':'ready',selector:{accountType:'deposit',accountLast4:'1234'},visibility:'owner_only',includedInTotals:false,refreshOnOpen:true,credentialsStored:true,consentVersion:2,consentedAt:instant,lastAttemptAt:null,lastSuccessAt:balance===null?null:instant,nextRefreshAt:null,canRefresh:true,errorCode:null,createdAt:instant,updatedAt:instant,snapshot:balance===null?null:{formatVersion:1,provider:'shinhan',source:'browser_assisted',origin:'https://bank.shinhan.com',pageKind:'deposit_account_list',capturedAt:instant,accountFingerprint:'a'.repeat(64),accountLast4:'1234',currency:'KRW',balanceKind:'ledger',balanceKrw:balance,bankAsOfDate:null}});
const card=(item:BankConnection,canManage=true)=>renderToStaticMarkup(<BankConnectionCard item={item} canManage={canManage} disabled={false} onRefresh={()=>{}} onDisconnect={()=>{}} />).replace(/<[^>]*>/g,'');
describe('bank deposit display boundaries',()=>{
 it('a missing observation is not shown as a zero balance',()=>{
  const html=card(deposit(null));expect(html).toContain('아직 조회한 잔액이 없어요');expect(html).not.toContain('0원');expect(html).not.toContain('만기일');
 });
 it('an observed zero balance is displayed as zero with its capture time',()=>{
  const html=card(deposit('0'));expect(html).toContain('통장 잔액0원');expect(html).toContain('화면 확인');expect(html).toContain('은행 잔액 기준일 미확인');
 });
 it('negative and large integer balances are formatted without precision loss',()=>{
  expect(card(deposit('-12345'))).toContain('-12,345원');expect(card(deposit('9007199254740993'))).toContain('9,007,199,254,740,993원');
 });
 it('a failed refresh keeps the previous observation and explains the error',()=>{
  const html=card({...deposit('1234'),status:'error',errorCode:'unsupported_layout',canRefresh:false});
  expect(html).toContain('이전 조회 내역');expect(html).toContain('1,234원');expect(html).toContain('이전 금액은 바뀌지 않았어요');
 });
 it('existing loan consent and loan amounts retain their distinct presentation',()=>{
  const value=deposit(null);const loan:BankConnection={...value,selector:{accountLast4:'1234',loanType:'interim'},consentVersion:1,snapshot:{formatVersion:1,provider:'shinhan',source:'browser_assisted',origin:'https://bank.shinhan.com',pageKind:'loan_account_list',capturedAt:instant,accountFingerprint:'a'.repeat(64),accountLast4:'1234',loanType:'interim',outstandingPrincipalKrw:'1234',maturityDate:null,bankAsOfDate:null}};
  const html=card(loan,false);expect(html).toContain('남은 원금1,234원');expect(html).toContain('만기일 미확인');expect(html).not.toContain('통장 잔액');expect(html).not.toContain('새로 조회');
 });
 it('registration separates deposit choice and consent from the two loan choices',()=>{
  const html=renderToStaticMarkup(<BankRegistrationForm busy={false} onSubmit={async()=>{}} onClose={()=>{}} />);
  expect(html).toContain('입출금 통장');expect(html).toContain('전세 대출');expect(html).toContain('중도금 대출');expect(html).toContain('선택한 통장의 원화 잔액');
  expect(html).not.toContain('checked=');expect(html.match(/type="password"[^>]*>/)?.[0]).not.toContain('value=');
 });
});
