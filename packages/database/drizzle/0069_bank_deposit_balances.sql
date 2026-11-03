-- Preserve loan grants and their consent. No financial observations are backfilled.
ALTER TABLE bank_connections ADD COLUMN account_type text NOT NULL DEFAULT 'loan';
--> statement-breakpoint
ALTER TABLE bank_connections ALTER COLUMN loan_type DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE bank_connections DROP CONSTRAINT bank_connections_selector_check;
--> statement-breakpoint
ALTER TABLE bank_connections DROP CONSTRAINT bank_connections_version_check;
--> statement-breakpoint
ALTER TABLE bank_connections ADD CONSTRAINT bank_connections_selector_check CHECK (
 account_last4 ~ '^[0-9]{4}$' AND (
  (account_type = 'loan' AND loan_type IS NOT NULL AND loan_type IN ('interim','jeonse')) OR
  (account_type = 'deposit' AND loan_type IS NULL)
 )
);
--> statement-breakpoint
ALTER TABLE bank_connections ADD CONSTRAINT bank_connections_account_version_check CHECK (
 version > 0 AND ((account_type = 'loan' AND consent_version IN (1,2)) OR (account_type = 'deposit' AND consent_version = 2))
);
--> statement-breakpoint
DROP INDEX bank_connections_active_selector;
--> statement-breakpoint
CREATE UNIQUE INDEX bank_connections_active_selector ON bank_connections(
 owner_user_id,household_id,provider,account_type,account_last4,coalesce(loan_type,'')
) WHERE disconnected_at IS NULL;
