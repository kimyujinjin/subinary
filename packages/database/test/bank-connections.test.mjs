import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
const migration=await readFile(new URL('../drizzle/0068_bank_connections.sql',import.meta.url),'utf8');
const depositMigration=await readFile(new URL('../drizzle/0069_bank_deposit_balances.sql',import.meta.url),'utf8');
test('deposit expansion preserves old grants, keeps consent scoped and makes null loan subtype unique',()=>{
 assert.match(depositMigration,/account_type text NOT NULL DEFAULT 'loan'/);
 assert.match(depositMigration,/account_type = 'deposit' AND loan_type IS NULL/);
 assert.match(depositMigration,/account_type = 'deposit' AND consent_version = 2/);
 assert.match(depositMigration,/account_type,account_last4,coalesce\(loan_type,''\)/);
 assert.doesNotMatch(depositMigration,/UPDATE |DELETE FROM|DROP TABLE|DROP TRIGGER|CREATE OR REPLACE FUNCTION|ALTER TABLE finance_connections/i);
});
test('bank grants bind both household/owner and membership incarnation',()=>{
 assert.match(migration,/member_id uuid NOT NULL REFERENCES household_members/);
 assert.match(migration,/member_joined_at timestamptz NOT NULL/);
 assert.match(migration,/consent_version integer NOT NULL DEFAULT 1/);
 assert.match(migration,/FOREIGN KEY\(connection_id,household_id,owner_user_id\)/);
 assert.match(migration,/NEW\.joined_at IS DISTINCT FROM OLD\.joined_at/);
});
test('rollback keeps DB-level credential revocation for membership, role and scope deletion',()=>{
 assert.match(migration,/NEW\.role = 'viewer'/);
 assert.match(migration,/credentials = NULL/);
 assert.match(migration,/bank_user_revoke AFTER UPDATE OF deleted_at ON users/);
 assert.match(migration,/bank_household_revoke AFTER UPDATE OF deleted_at ON households/);
 assert.match(migration,/LEAST\(version::bigint\+1,2147483647\)/);
});
test('observations are terminal once and cannot be deleted or overwritten',()=>{
 assert.match(migration,/IF TG_OP = 'DELETE'/);
 assert.match(migration,/OLD\.state <> 'pending' OR NEW\.state = 'pending'/);
 assert.match(migration,/BEFORE UPDATE OR DELETE ON bank_connection_snapshots/);
});
test('migration is additive, includes no provider secrets, and leaves securities policy alone',()=>{
 assert.doesNotMatch(migration,/DROP TABLE|ALTER TABLE finance_connections|INSERT INTO|password\s+(?:text|varchar)|login_id\s+(?:text|varchar)/i);
 assert.match(migration,/credentials jsonb/);
});
