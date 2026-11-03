import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { allowedRequest, keyFor, selectedCapture, validateJob } from '../policy.mjs';

const capture = { formatVersion:1,provider:'shinhan',source:'browser_assisted',origin:'https://bank.shinhan.com',
 pageKind:'loan_account_list',capturedAt:'2026-11-02T00:00:00.000Z',accountFingerprint:'a'.repeat(64),accountLast4:'1234',
 loanType:'interim',outstandingPrincipalKrw:'9007199254740993',maturityDate:'2030-02-28',bankAsOfDate:null };
const job = () => ({provider:'shinhan_bank',credentials:{loginId:'synthetic-id',password:'Synthetic!123'},selector:{accountLast4:'1234',loanType:'interim'}});
test('only fixed HTTPS bank origin can receive a browser request',()=>{
 assert.equal(allowedRequest('https://bank.shinhan.com/index.jsp#011100000000'),true);
 for(const url of ['http://bank.shinhan.com','https://bank.shinhan.com.evil.invalid/','https://evil.invalid/','https://user:password@bank.shinhan.com/','file:///tmp/bank','https://bank.shinhan.com:444/']) assert.equal(allowedRequest(url),false,url);
});
test('job never accepts URL, arbitrary provider, raw account or extra credentials',()=>{
 assert.deepEqual(validateJob(job()),job());
 for(const value of [{...job(),provider:'kb_bank'},{...job(),url:'https://evil.invalid'},{...job(),credentials:{...job().credentials,cookie:'private'}},{...job(),selector:{...job().selector,fullAccount:'123456789012'}},{...job(),credentials:{loginId:'id',password:'bad\npassword'}}]) assert.throws(()=>validateJob(value),/Bank read did not complete/);
});
test('known normal virtual-keyboard labels cover printable ASCII without hidden-field injection',()=>{
 for(let code=33;code<=126;code++) { const key=keyFor(String.fromCharCode(code)); assert.equal(typeof key.label,'string');assert.equal(typeof key.shift,'boolean'); }
 assert.deepEqual(keyFor('!'),{shift:true,label:'느낌표'});
 assert.deepEqual(keyFor('A'),{shift:true,label:'대문자A'});
 assert.deepEqual(keyFor('a'),{shift:false,label:'a'});
 for(const value of [' ', '한', '\n', 'ab'])assert.throws(()=>keyFor(value));
});
test('only the explicitly chosen loan leaves the collector, preserving decimal precision',()=>{
 const other={...capture,accountFingerprint:'b'.repeat(64),accountLast4:'5678',outstandingPrincipalKrw:'0'};
 assert.deepEqual(selectedCapture({ok:true,captures:[capture,other]},job().selector),capture);
 assert.throws(()=>selectedCapture({ok:true,captures:[other]},job().selector),error=>error.code==='account_not_found');
 assert.throws(()=>selectedCapture({ok:true,captures:[capture,{...capture,accountFingerprint:'b'.repeat(64)}]},job().selector),error=>error.code==='account_ambiguous');
});
test('extra fields and guessed dates cannot cross the output boundary',()=>{
 for(const row of [{...capture,fullAccount:'123456789012'},{...capture,bankAsOfDate:'2026-11-02'},{...capture,outstandingPrincipalKrw:100},{...capture,maturityDate:'2030-02-31'}]) assert.throws(()=>selectedCapture({ok:true,captures:[row]},job().selector));
});
test('runner has no traces, persistent browser, security bypass, model call or direct bank transaction API',async()=>{
 const runtime=await readFile(new URL('../run.mjs',import.meta.url),'utf8');
 const driver=await readFile(new URL('../shinhan.mjs',import.meta.url),'utf8');
 assert.match(runtime,/chromiumSandbox: true/);
 assert.match(runtime,/acceptDownloads: false/);
 assert.doesNotMatch(runtime+driver,/launchPersistentContext|storageState|ignoreHTTPSErrors|--no-sandbox|connectOverCDP|\.tracing|recordVideo|console\.|request\.(post|put)|openai|anthropic|claude/);
 assert.equal((driver.match(/visibleLinks\('ID 로그인'\)\.click/g)??[]).length,1);
 assert.doesNotMatch(driver,/getByRole\([^\n]*(?:이체|송금|상환|주문|매수|매도)/);
});
