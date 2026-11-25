CREATE TABLE "pin_attempt" (
	"household_id" text NOT NULL,
	"scope" text NOT NULL,
	"failures" integer NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	CONSTRAINT "pin_attempt_household_id_scope_pk" PRIMARY KEY("household_id","scope")
);
--> statement-breakpoint
ALTER TABLE "pin_attempt" ADD CONSTRAINT "pin_attempt_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;