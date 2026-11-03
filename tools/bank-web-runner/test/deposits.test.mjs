import assert from 'node:assert/strict';
import { test } from 'node:test';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { collectShinhanDeposits } from '../shinhan-deposits.mjs';
import { selectedCapture, validateJob } from '../policy.mjs';
import { isSanitizedCapture } from '../capture.mjs';
import { fixtureDocument, pageHtml, tableHtml } from '../../shinhan-loan-collector/test/synthetic-dom.mjs';
if (!globalThis.crypto) Object.defineProperty(globalThis,'crypto',{value:webcrypto});

// Only public table names/column labels come from the live screen. Every row,
// date, account and amount below is synthetic; the DOM shape remains a fixture.
const selector={accountType:'deposit',accountLast4:'9012'};
const headers=['계좌명','계좌번호','신규일','최근거래일','잔액(원)','업무'];
const currentSummary='입/출금 계좌정보은(는) 계좌명,계좌번호,신규일,최근거래일,잔액(원),업무 을(를) 나타낸 표';
const row=(account='123-456-789012',balance='9,007,199,254,740,993 원')=>['합성 통장',account,'2025.01.01','2026.01.01',balance,'조회'];
const currentTable=(rows=[row()],options={})=>tableHtml({headers,rows,tableAttributes:'summary="'+currentSummary+'"',...options});
const page=(rows=[row()],options={})=>pageHtml({title:'계좌조회-예금/신탁 | 신한은행 개인뱅킹',heading:'계좌조회',body:currentTable(rows,options)});
const collect=(html=page(),options)=>collectShinhanDeposits({selector,rootDocument:fixtureDocument(html,options)});

test('live-observed current-account label selects one table among deposits, savings and FX without a currency heading',async()=>{
 const savings=tableHtml({headers:['계좌명','계좌번호','신규일','만기일','잔액(원)','업무'],rows:[row('999-999-999012','not-a-current-balance')],tableAttributes:'summary="예금/적금/신탁 계좌정보은(는) 계좌명,계좌번호,신규일,만기일,잔액(원),업무 을(를) 나타낸 표"'});
 const foreign=tableHtml({headers:['계좌명','계좌번호','신규일','만기일','통화','잔액','업무'],rows:[['합성 외화','999-999-999012','','','USD','not-a-KRW-balance','조회']],tableAttributes:'summary="외화신탁 계좌정보은(는) 계좌명,계좌번호,신규일,만기일,통화,잔액,업무 을(를) 나타낸 표"'});
 const total=tableHtml({headers:['예금/신탁 총 잔액'],rows:[['not-a-selected-account']],tableAttributes:'summary="예금/신탁 총 잔액 을(를) 나타낸 표"'});
 const html=pageHtml({title:'계좌조회-예금/신탁 | 신한은행 개인뱅킹',heading:'계좌조회',body:currentTable()+savings+foreign+total});
 const result=await collect(html);assert.equal(result.ok,true);assert.equal(result.captures.length,1);
 const value=selectedCapture(result,selector);assert.equal(value.balanceKrw,'9007199254740993');assert.equal(isSanitizedCapture(value),true);
 for(const privateValue of ['123-456-789012','123456789012','not-a-current-balance','not-a-KRW-balance'])assert.equal(JSON.stringify(result).includes(privateValue),false);
 assert.throws(()=>selectedCapture(result,{loanType:'interim',accountLast4:'9012'}),error=>error.code==='account_not_found');
});
test('zero and negative ledger balances remain exact with the observed KRW header',async()=>{
 for(const [shown,expected]of [['0','0'],['-12,345 원','-12345']]){
  const result=await collect(page([row('123456789012',shown)]));assert.equal(result.captures[0].balanceKrw,expected);
 }
});
test('recent transaction date is normal account metadata, not transaction history',async()=>{
 assert.equal((await collect()).ok,true);
 for(const historyHeader of ['거래일','거래일시','입금액','출금액','거래금액']){
  const changed=[...headers];changed[3]=historyHeader;
  assert.equal((await collect(page([row()],{headers:changed}))).ok,false);
 }
});
test('other current-account amounts are not read and ambiguous matching last four digits are rejected',async()=>{
 const result=await collect(page([row('999999999999','not-an-amount'),row('123456789012','10 원')]));
 assert.equal(result.ok,true);assert.equal(result.captures[0].balanceKrw,'10');
 assert.deepEqual(await collect(page([row('123456789012','10 원'),row('999999999012','20 원')])),{ok:false,error:'ACCOUNT_AMBIGUOUS'});
 assert.deepEqual(await collect(page([row('999999999999','not-read')])),{ok:true,captures:[]});
});
test('decimal, loading, malformed and foreign amounts never become zero',async()=>{
 for(const amount of ['1.23 원','-0 원','조회중','1,23 원','10 USD','20,000,000,000,000,000,000,000 원'])
  assert.deepEqual(await collect(page([row('123456789012',amount)])),{ok:false,error:'INVALID_AMOUNT'});
});
test('withdrawable, loan and unitless balance columns cannot substitute the observed ledger header',async()=>{
 for(const column of ['출금가능금액','대출잔액','대출한도','잔액','잔액(USD)']){
  const changed=[...headers];changed[4]=column;
  assert.equal((await collect(page([row()],{headers:changed}))).ok,false);
 }
});
test('bank origin, top-level scope, bank title and verified table identity are required',async()=>{
 for(const options of [{url:'https://foreign.invalid/'},{url:'https://bank.shinhan.com.evil.invalid/'},{topLevel:false}])assert.equal((await collect(page(),options)).ok,false);
 assert.equal((await collect(page().replace(' | 신한은행 개인뱅킹',''))).ok,false);
 for(const identity of ['', '예금/적금/신탁 계좌정보','입/출금 계좌정보 거래내역'])
  assert.equal((await collect(page([row()],{tableAttributes:'summary="'+identity+'"'}))).ok,false);
});
test('standard table metadata names are explicit and conflicting identity fails closed',async()=>{
 for(const options of [{tableAttributes:'aria-label="입/출금 계좌정보"'},{tableAttributes:'',caption:'입/출금 계좌정보'}])
  assert.equal((await collect(page([row()],options))).ok,true);
 assert.equal((await collect(page([row()],{tableAttributes:'summary="'+currentSummary+'" aria-label="외화신탁 계좌정보"'}))).ok,false);
});
test('hidden, repeated and malformed named tables fail closed without exporting raw text',async()=>{
 assert.deepEqual(await collect(page().replace('</body>',currentTable()+'</body>')),{ok:false,error:'AMBIGUOUS_TABLE'});
 const hidden=page().replace('<td>123-456-789012','<td hidden>123-456-789012');assert.equal((await collect(hidden)).ok,false);
 const changed=[...headers];changed[5]='잔액(원)';assert.equal((await collect(page([row()],{headers:changed}))).ok,false);
 assert.equal((await collect(page([row()],{tableAttributes:'summary="'+currentSummary+'" hidden'}))).ok,false);
});
test('an unlabelled balance table is not read or treated as a second current-account table',async()=>{
 const other=tableHtml({headers,rows:[row('999999999012','not-a-selected-amount')]});
 const result=await collect(page().replace('</body>',other+'</body>'));
 assert.equal(result.ok,true);assert.equal(result.captures[0].balanceKrw,'9007199254740993');
});
test('collector survives function serialization and deposit jobs cannot request arbitrary URLs',async()=>{
 const isolated=vm.runInNewContext('('+collectShinhanDeposits.toString()+')',{URL,TextEncoder,crypto:webcrypto});
 assert.equal((await isolated({selector,rootDocument:fixtureDocument(page())})).ok,true);
 const job={provider:'shinhan_bank',credentials:{loginId:'synthetic-id',password:'Synthetic!123'},selector};
 assert.equal(validateJob(job),job);
 assert.throws(()=>validateJob({...job,selector:{...selector,loanType:'interim'}}));
 assert.throws(()=>validateJob({...job,url:'https://foreign.invalid/'}));
});
