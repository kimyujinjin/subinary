import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const container = process.env.CARD_OWNERSHIP_VERIFY_CONTAINER;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** @param {number} value @returns {string} */
const id = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

/** @param {string} query @returns {string} */
function sql(query) {
  // 이름·로그인·DB 세 가지를 고정해 운영DB에서 테스트 DDL을 실행할 수 없게 한다.
  assert.match(container ?? '', /^fma-ownership-verify-[a-z0-9-]+$/u);
  return execFileSync('docker', ['exec','-i',container,'psql','-X','-v','ON_ERROR_STOP=1','-U','verify','-d','family_memory_verify','-At'], {
    input: query, encoding: 'utf8', stdio: ['pipe','pipe','pipe'],
  });
}

/** @returns {void} */
function fixtures() {
  sql(`DROP TABLE IF EXISTS card_transactions,card_sms_events,payment_cards;
CREATE TABLE payment_cards (id uuid PRIMARY KEY,owner_member_id uuid NOT NULL,is_shared boolean NOT NULL);
CREATE TABLE card_sms_events (id uuid PRIMARY KEY,member_id uuid NOT NULL);
CREATE TABLE card_transactions (
 id uuid PRIMARY KEY,household_id uuid NOT NULL,member_id uuid NOT NULL,card_id uuid,
 source_event_id uuid NOT NULL,parent_transaction_id uuid,status text NOT NULL,
 transaction_type text NOT NULL,amount integer NOT NULL,net_amount integer NOT NULL,
 cancelled_amount integer NOT NULL,visibility text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO payment_cards VALUES ('${id(3)}','${id(2)}',false),('${id(4)}','${id(2)}',true);
INSERT INTO card_sms_events VALUES
 ('${id(101)}','${id(1)}'),('${id(102)}','${id(1)}'),('${id(103)}','${id(2)}'),
 ('${id(104)}','${id(1)}'),('${id(105)}','${id(2)}'),('${id(106)}','${id(1)}');
INSERT INTO card_transactions (id,household_id,member_id,card_id,source_event_id,parent_transaction_id,status,transaction_type,amount,net_amount,cancelled_amount,visibility) VALUES
 ('${id(201)}','${id(9)}','${id(1)}','${id(3)}','${id(101)}',NULL,'partially_cancelled','approval',10000,9000,1000,'private'),
 ('${id(202)}','${id(9)}','${id(1)}','${id(3)}','${id(102)}','${id(201)}','approved','cancellation',1000,0,0,'private'),
 ('${id(203)}','${id(9)}','${id(2)}','${id(3)}','${id(103)}',NULL,'approved','approval',3000,3000,0,'household'),
 ('${id(204)}','${id(9)}','${id(1)}','${id(4)}','${id(104)}',NULL,'approved','approval',2000,2000,0,'household'),
 ('${id(205)}','${id(9)}','${id(1)}','${id(3)}','${id(105)}',NULL,'approved','approval',1000,1000,0,'household'),
 ('${id(206)}','${id(9)}','${id(1)}','${id(3)}','${id(106)}','${id(203)}','approved','cancellation',500,0,0,'household');`);
}

/** @param {string[]} args @returns {Record<string, unknown>} */
function cli(args) {
  const stdout = execFileSync(process.execPath, ['scripts/repair-card-ownership.mjs', ...args], {
    cwd: root, env: { ...process.env, CARD_OWNERSHIP_DB_CONTAINER: container },
    encoding: 'utf8', stdio: ['pipe','pipe','pipe'],
  });
  return JSON.parse(stdout.trim());
}

test('격리 PostgreSQL에서 소유자 정정·부분실행 롤백·재실행·카드정보 충돌을 검증한다', {
  skip: !container,
}, () => {
  const directory = mkdtempSync(join(tmpdir(), 'fma-card-ownership-'));
  try {
    fixtures();
    const firstPath = join(directory, 'first.json');
    const first = cli(['plan', firstPath]);
    assert.equal(first.targets, 2);
    assert.equal(first.manualReview, 2);
    assert.equal(Number(sql('SELECT count(*) FROM card_transactions WHERE card_id IS NULL;').trim()), 0);

    sql(`UPDATE card_transactions SET updated_at=updated_at+interval '1 second' WHERE id='${id(202)}';`);
    assert.throws(() => cli(['apply', firstPath, '--expected-count=2']));
    // 첫 행의 UPDATE까지 수행했더라도 뒤 행이 낡았으면 전체 트랜잭션이 롤백된다.
    assert.equal(Number(sql('SELECT count(*) FROM card_transactions WHERE card_id IS NULL;').trim()), 0);

    const secondPath = join(directory, 'second.json');
    cli(['plan', secondPath]);
    const before = JSON.parse(sql("SELECT json_agg(to_jsonb(t)-'card_id'-'updated_at' ORDER BY id) FROM card_transactions t;").trim());
    const applied = cli(['apply', secondPath, '--expected-count=2']);
    const receipt = JSON.parse(readFileSync(String(applied.receipt), 'utf8'));
    assert.equal(receipt.result.results.filter((entry) => entry.status === 'applied').length, 2);
    assert.equal(Number(sql('SELECT count(*) FROM card_transactions WHERE card_id IS NULL;').trim()), 2);
    const after = JSON.parse(sql("SELECT json_agg(to_jsonb(t)-'card_id'-'updated_at' ORDER BY id) FROM card_transactions t;").trim());
    assert.deepEqual(after, before);

    const repeated = cli(['apply', secondPath, '--expected-count=2']);
    const repeatedReceipt = JSON.parse(readFileSync(String(repeated.receipt), 'utf8'));
    assert.equal(repeatedReceipt.result.results.filter((entry) => entry.status === 'already_applied').length, 2);

    fixtures();
    const thirdPath = join(directory, 'third.json');
    cli(['plan', thirdPath]);
    sql(`UPDATE payment_cards SET is_shared=true WHERE id='${id(3)}';`);
    assert.throws(() => cli(['apply', thirdPath, '--expected-count=2']));
    assert.equal(Number(sql('SELECT count(*) FROM card_transactions WHERE card_id IS NULL;').trim()), 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
