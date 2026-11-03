import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readShinhanLoan, prepareShinhanLogin } from '../shinhan.mjs';

const capture={formatVersion:1,provider:'shinhan',source:'browser_assisted',origin:'https://bank.shinhan.com',pageKind:'loan_account_list',
 capturedAt:'2026-11-02T00:00:00.000Z',accountFingerprint:'a'.repeat(64),accountLast4:'1234',loanType:'interim',outstandingPrincipalKrw:'12345',maturityDate:null,bankAsOfDate:null};
function fake({notice='ID로그인 시에는 이용 가능한 서비스가 제한 (단순 계좌 조회)',origin='https://bank.shinhan.com',authenticated=true,logoutFails=false,loginFieldUnavailable=false,keyboardClickTimesOut=false,keyboardUnavailable=false,installationGuide=false,keyboardDelayed=false,captures=[capture],collectionFails=false,loginClickFails=false,originAfterCapture=null,logoutControls=1}={}){
 const actions=[];
 let loggedOut=false,loanSidebarOpened=false,keyboardOpen=false,guideClosed=false,currentOrigin=origin;
 function locator(name,choice=null){return {filter(){return this;},first(){return locator(name,'first');},last(){return locator(name,'last');},async count(){return name==='.w2popup_window'?(installationGuide&&!guideClosed?1:0):name==='대출'?2:name==='로그아웃'?(authenticated&&!loggedOut?logoutControls:0):1;},async click(){actions.push(['click',name,choice]);if(name==='guide:닫기')guideClosed=true;if(name==='a[id="비밀번호_tk_btn"]'){if(installationGuide&&!guideClosed)throw new Error('GUIDE_INTERCEPTED');keyboardOpen=!keyboardUnavailable&&!keyboardDelayed;if(keyboardClickTimesOut)throw new Error('KEYBOARD_CONTROL_CHANGED');}if(name==='가상키보드 닫기')keyboardOpen=false;if(name==='대출'&&choice==='first')loanSidebarOpened=true;if(name==='로그아웃'&&!logoutFails)loggedOut=true;if(name==='ID 로그인'&&loginClickFails)throw new Error('PRIVATE_LOGIN_RESPONSE');},async fill(value){actions.push(['fill',name,value]);},async waitFor(options){actions.push(['wait',name]);if(name==='오른쪽 엔터'&&options?.state==='visible'&&keyboardDelayed&&!keyboardUnavailable)keyboardOpen=true;if(name==='#ibx_loginId'&&loginFieldUnavailable)throw new Error('FORM_NOT_READY');if(name==='오른쪽 엔터'&&(options?.state==='hidden'?keyboardOpen:!keyboardOpen))throw new Error('NO_KEYBOARD');if(name==='원화 대출'&&!loanSidebarOpened)throw new Error('DEPOSIT_TAB_DID_NOT_NAVIGATE');if(name==='로그아웃'&&(options?.state==='hidden'?!loggedOut:!authenticated||loggedOut))throw new Error('PRIVATE_AUTH_TEXT');},async isVisible(){return name==='#grp_alertlayer'||name==='오른쪽 엔터'&&keyboardOpen;},async innerText(){return notice;},getByRole(_role,options){return locator(options.name);},getByText(text){return locator('guide:'+text);}};}
 return {actions,page:{goto:async url=>actions.push(['goto',url]),url:()=>currentOrigin+'/index.jsp',locator,getByRole:(_role,options)=>locator(options.name),evaluate:async ()=>{actions.push(['collect']);if(originAfterCapture)currentOrigin=originAfterCapture;if(collectionFails)throw new Error('PRIVATE_FINANCIAL_PAGE');return {ok:true,captures};}}};
}
const job=()=>({provider:'shinhan_bank',credentials:{loginId:'synthetic-id',password:'aB!2'},selector:{accountLast4:'1234',loanType:'interim'}});
test('ordinary login -> allowed query navigation -> one selected observation; credentials cleared',async()=>{
 const f=fake(),input=job();
 assert.deepEqual(await readShinhanLoan(f.page,input),capture);
 assert.equal(f.actions.filter(row=>row[0]==='click'&&row[1]==='ID 로그인').length,1);
 assert.equal(f.actions.filter(row=>row[0]==='click'&&row[1]==='로그아웃').length,1);
 assert.deepEqual(f.actions.filter(row=>row[0]==='click'&&row[1]==='대출'),[['click','대출','first']]);
 assert.equal(f.actions.some(row=>row[1]==='느낌표'),true);
 assert.deepEqual(input.credentials,{loginId:'',password:''});
 assert.ok(f.actions.findIndex(row=>row[0]==='wait'&&row[1]==='#ibx_loginId')<f.actions.findIndex(row=>row[0]==='fill'));
 assert.equal(f.actions.some(row=>/이체|송금|약관/.test(row[1])),false);
});
test('unready public login form receives no credential and no login submission',async()=>{
 const f=fake({loginFieldUnavailable:true}),input=job();
 await assert.rejects(readShinhanLoan(f.page,input),error=>error.code==='unsupported_layout');
 assert.equal(f.actions.some(row=>row[0]==='fill'||row[1]==='ID 로그인'),false);
 assert.equal(f.actions.some(row=>row[0]==='click'&&row[1]==='로그아웃'),false);
 assert.deepEqual(input.credentials,{loginId:'',password:''});
});
test('keyboard control timeout is accepted only after the normal keyboard visibly opens',async()=>{
 const f=fake({keyboardClickTimesOut:true}),input=job();
 assert.deepEqual(await readShinhanLoan(f.page,input),capture);
 assert.equal(f.actions.filter(row=>row[0]==='click'&&row[1]==='a[id="비밀번호_tk_btn"]').length,2);
 assert.equal(f.actions.filter(row=>row[0]==='click'&&row[1]==='ID 로그인').length,1);
});
test('preflight failure without a visible keyboard stops before any credential or login submission',async()=>{
 const f=fake({keyboardClickTimesOut:true,keyboardUnavailable:true}),input=job();
 await assert.rejects(readShinhanLoan(f.page,input),error=>error.code==='unsupported_layout');
 assert.equal(f.actions.some(row=>row[1]==='ID 로그인'||row[1]==='a'),false);
 assert.deepEqual(input.credentials,{loginId:'',password:''});
});
test('unconfirmed normal logout never returns the captured financial observation',async()=>{
 const f=fake({logoutFails:true}),input=job();
 await assert.rejects(readShinhanLoan(f.page,input),error=>error.code==='operation_unknown');
 assert.deepEqual(input.credentials,{loginId:'',password:''});
 assert.equal(f.actions.filter(row=>row[1]==='ID 로그인').length,1);
 assert.equal(f.actions.filter(row=>row[0]==='click'&&row[1]==='로그아웃').length,1);
});

test('selected account missing still performs verified normal logout without hiding the lookup error',async()=>{
 const f=fake({captures:[]}),input=job();
 await assert.rejects(readShinhanLoan(f.page,input),error=>error.code==='account_not_found');
 assert.equal(f.actions.filter(row=>row[0]==='click'&&row[1]==='로그아웃').length,1);
 assert.equal(f.actions.at(-1)[1],'#ibx_loginId');
 assert.deepEqual(input.credentials,{loginId:'',password:''});
});
test('private collection failure is sanitized and still logs out after one login',async()=>{
 const f=fake({collectionFails:true}),input=job();
 await assert.rejects(readShinhanLoan(f.page,input),error=>error.code==='unsupported_layout'&&!error.message.includes('PRIVATE_FINANCIAL_PAGE'));
 assert.equal(f.actions.filter(row=>row[0]==='click'&&row[1]==='ID 로그인').length,1);
 assert.equal(f.actions.filter(row=>row[0]==='click'&&row[1]==='로그아웃').length,1);
 assert.deepEqual(input.credentials,{loginId:'',password:''});
});
test('failed logout after a lookup error is reported as unknown and never retried',async()=>{
 const f=fake({captures:[],logoutFails:true}),input=job();
 await assert.rejects(readShinhanLoan(f.page,input),error=>error.code==='operation_unknown');
 assert.equal(f.actions.filter(row=>row[0]==='click'&&row[1]==='로그아웃').length,1);
 assert.equal(f.actions.filter(row=>row[0]==='click'&&row[1]==='ID 로그인').length,1);
 assert.deepEqual(input.credentials,{loginId:'',password:''});
});
test('ambiguous login click result cleans up a visible bank session without submitting again',async()=>{
 const f=fake({loginClickFails:true}),input=job();
 await assert.rejects(readShinhanLoan(f.page,input),error=>error.code==='unsupported_layout'&&!error.message.includes('PRIVATE_LOGIN_RESPONSE'));
 assert.equal(f.actions.filter(row=>row[0]==='click'&&row[1]==='ID 로그인').length,1);
 assert.equal(f.actions.filter(row=>row[0]==='click'&&row[1]==='로그아웃').length,1);
 assert.deepEqual(input.credentials,{loginId:'',password:''});
});
test('an unauthenticated result performs no logout click or second login',async()=>{
 const f=fake({authenticated:false}),input=job();
 await assert.rejects(readShinhanLoan(f.page,input),error=>error.code==='authentication_required');
 assert.equal(f.actions.filter(row=>row[0]==='click'&&row[1]==='ID 로그인').length,1);
 assert.equal(f.actions.filter(row=>row[0]==='click'&&row[1]==='로그아웃').length,0);
 assert.deepEqual(input.credentials,{loginId:'',password:''});
});
test('cleanup never clicks a logout control after leaving the bank origin',async()=>{
 const f=fake({collectionFails:true,originAfterCapture:'https://foreign.invalid'}),input=job();
 await assert.rejects(readShinhanLoan(f.page,input),error=>error.code==='operation_unknown');
 assert.equal(f.actions.filter(row=>row[0]==='click'&&row[1]==='로그아웃').length,0);
 assert.deepEqual(input.credentials,{loginId:'',password:''});
});
test('ambiguous logout controls leave the observation unreturned without clicking either',async()=>{
 const f=fake({logoutControls:2}),input=job();
 await assert.rejects(readShinhanLoan(f.page,input),error=>error.code==='operation_unknown');
 assert.equal(f.actions.filter(row=>row[0]==='click'&&row[1]==='로그아웃').length,0);
 assert.deepEqual(input.credentials,{loginId:'',password:''});
});
test('deposit query uses the deposit menu, selected observation and verified normal logout',async()=>{
 const deposit={formatVersion:1,provider:'shinhan',source:'browser_assisted',origin:'https://bank.shinhan.com',pageKind:'deposit_account_list',capturedAt:'2026-11-03T00:00:00.000Z',accountFingerprint:'b'.repeat(64),accountLast4:'1234',currency:'KRW',balanceKind:'ledger',balanceKrw:'0',bankAsOfDate:null};
 const f=fake({captures:[deposit]}),input={...job(),selector:{accountLast4:'1234',accountType:'deposit'}};
 assert.deepEqual(await readShinhanLoan(f.page,input),deposit);
 assert.equal(f.actions.some(row=>row[0]==='click'&&row[1]==='대출'),false);
 assert.equal(f.actions.filter(row=>row[0]==='click'&&row[1]==='예금/신탁').length,1);
 assert.equal(f.actions.some(row=>row[0]==='wait'&&row[1] instanceof RegExp&&row[1].test('입/출금 계좌정보은(는) 계좌명,계좌번호,신규일,최근거래일,잔액(원),업무 을(를) 나타낸 표')),true);
 assert.equal(f.actions.some(row=>row[0]==='wait'&&row[1]==='원화 예금'),false);
 assert.equal(f.actions.filter(row=>row[0]==='click'&&row[1]==='로그아웃').length,1);
 assert.deepEqual(input.credentials,{loginId:'',password:''});
});
for(const [name,notice,code]of [['bad credential','비밀번호가 일치하지 않습니다','credentials_invalid'],['unexpected agreement','약관에 동의해 주세요','authentication_required'],['OTP','추가 인증번호를 입력해 주세요','authentication_required']])test(name+' stops after one attempt, never accepts unknown agreement/challenge',async()=>{
 const f=fake({notice}),input=job();
 await assert.rejects(readShinhanLoan(f.page,input),error=>error.code===code&&!error.message.includes(notice));
 assert.equal(f.actions.filter(row=>row[1]==='ID 로그인').length,1);
 assert.equal(f.actions.some(row=>row[1]==='확인'),false);
 assert.deepEqual(input.credentials,{loginId:'',password:''});
});
test('foreign redirect stops before entering login credentials',async()=>{
 const f=fake({origin:'https://evil.invalid'}),input=job();
 await assert.rejects(readShinhanLoan(f.page,input),error=>error.code==='authentication_required');
 assert.equal(f.actions.some(row=>row[0]==='fill'),false);
});

test('public security preflight opens and closes the empty normal keyboard without credentials',async()=>{
 const f=fake();
 await prepareShinhanLogin(f.page);
 assert.equal(f.actions.some(row=>row[0]==='fill'||row[1]==='ID 로그인'),false);
 assert.deepEqual(f.actions.filter(row=>row[0]==='click').map(row=>row[1]),['a[id="비밀번호_tk_btn"]','가상키보드 닫기']);
});
test('security module not ready prevents login ID transmission as well as password entry',async()=>{
 const f=fake({keyboardUnavailable:true}),input=job();
 await assert.rejects(readShinhanLoan(f.page,input),error=>error.code==='unsupported_layout');
 assert.equal(f.actions.some(row=>row[0]==='fill'||row[1]==='ID 로그인'),false);
 assert.deepEqual(input.credentials,{loginId:'',password:''});
});

test('only the exact public installation guide is normally closed before any credential',async()=>{
 const f=fake({installationGuide:true}),input=job();
 assert.deepEqual(await readShinhanLoan(f.page,input),capture);
 const closes=f.actions.filter(row=>row[0]==='click'&&row[1]==='guide:닫기');
 assert.equal(closes.length,1);
 assert.ok(f.actions.findIndex(row=>row[1]==='guide:닫기')<f.actions.findIndex(row=>row[0]==='fill'));
});
test('an unavailable keyboard without the known guide does not trigger arbitrary modal dismissal',async()=>{
 const f=fake({keyboardUnavailable:true,keyboardClickTimesOut:true}),input=job();
 await assert.rejects(readShinhanLoan(f.page,input),error=>error.code==='unsupported_layout');
 assert.equal(f.actions.some(row=>row[1]==='guide:닫기'||row[0]==='fill'||row[1]==='ID 로그인'),false);
});

test('delayed security keyboard must become visible and close before any credential is sent',async()=>{
 const f=fake({keyboardDelayed:true}),input=job();
 assert.deepEqual(await readShinhanLoan(f.page,input),capture);
 assert.ok(f.actions.findIndex(row=>row[0]==='click'&&row[1]==='가상키보드 닫기')<f.actions.findIndex(row=>row[0]==='fill'));
});
