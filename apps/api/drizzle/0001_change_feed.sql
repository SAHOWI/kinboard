ALTER TABLE "change_log" ADD COLUMN "seq" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "change_log_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "household" ADD COLUMN "history_from_rev" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Existing households: change_log is only known to be complete from their current revision on.
UPDATE "household" SET "history_from_rev" = "rev";
