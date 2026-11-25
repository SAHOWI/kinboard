CREATE TABLE "change_log" (
	"household_id" text NOT NULL,
	"rev" bigint NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"op" text NOT NULL,
	"payload" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_log_household_id_rev_entity_entity_id_pk" PRIMARY KEY("household_id","rev","entity","entity_id")
);
--> statement-breakpoint
CREATE TABLE "command_receipt" (
	"household_id" text NOT NULL,
	"command_id" text NOT NULL,
	"rev" bigint NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "command_receipt_household_id_command_id_pk" PRIMARY KEY("household_id","command_id")
);
--> statement-breakpoint
CREATE TABLE "event" (
	"household_id" text NOT NULL,
	"id" text NOT NULL,
	"ord" bigint GENERATED ALWAYS AS IDENTITY (sequence name "event_ord_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"title" text NOT NULL,
	"start" text NOT NULL,
	"end" text NOT NULL,
	"all_day" boolean NOT NULL,
	"location" text,
	"rrule" text,
	"source" text NOT NULL,
	CONSTRAINT "event_household_id_id_pk" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "event_assignee" (
	"household_id" text NOT NULL,
	"event_id" text NOT NULL,
	"member_id" text NOT NULL,
	"pos" integer NOT NULL,
	CONSTRAINT "event_assignee_household_id_event_id_member_id_pk" PRIMARY KEY("household_id","event_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "household" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"locale" text NOT NULL,
	"week_starts_on" smallint NOT NULL,
	"rev" bigint DEFAULT 0 NOT NULL,
	"pin_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "list" (
	"household_id" text NOT NULL,
	"id" text NOT NULL,
	"ord" bigint GENERATED ALWAYS AS IDENTITY (sequence name "list_ord_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"icon" text NOT NULL,
	"kind" text NOT NULL,
	"hidden" boolean NOT NULL,
	CONSTRAINT "list_household_id_id_pk" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "list_item" (
	"household_id" text NOT NULL,
	"id" text NOT NULL,
	"ord" bigint GENERATED ALWAYS AS IDENTITY (sequence name "list_item_ord_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"list_id" text NOT NULL,
	"text" text NOT NULL,
	"checked" boolean NOT NULL,
	"sort" double precision NOT NULL,
	CONSTRAINT "list_item_household_id_id_pk" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "list_visibility" (
	"household_id" text NOT NULL,
	"list_id" text NOT NULL,
	"member_id" text NOT NULL,
	"pos" integer NOT NULL,
	CONSTRAINT "list_visibility_household_id_list_id_member_id_pk" PRIMARY KEY("household_id","list_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "meal" (
	"household_id" text NOT NULL,
	"id" text NOT NULL,
	"ord" bigint GENERATED ALWAYS AS IDENTITY (sequence name "meal_ord_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"date" text NOT NULL,
	"slot" text NOT NULL,
	"title" text NOT NULL,
	"icon" text NOT NULL,
	CONSTRAINT "meal_household_id_id_pk" PRIMARY KEY("household_id","id"),
	CONSTRAINT "meal_household_id_date_slot_unique" UNIQUE("household_id","date","slot")
);
--> statement-breakpoint
CREATE TABLE "member" (
	"household_id" text NOT NULL,
	"id" text NOT NULL,
	"ord" bigint GENERATED ALWAYS AS IDENTITY (sequence name "member_ord_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"role" text NOT NULL,
	"color" text NOT NULL,
	"emoji" text NOT NULL,
	CONSTRAINT "member_household_id_id_pk" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "points_ledger" (
	"household_id" text NOT NULL,
	"id" text NOT NULL,
	"ord" bigint GENERATED ALWAYS AS IDENTITY (sequence name "points_ledger_ord_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"member_id" text NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"ref_id" text NOT NULL,
	"at" text NOT NULL,
	CONSTRAINT "points_ledger_household_id_id_pk" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "reward" (
	"household_id" text NOT NULL,
	"id" text NOT NULL,
	"ord" bigint GENERATED ALWAYS AS IDENTITY (sequence name "reward_ord_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"title" text NOT NULL,
	"icon" text NOT NULL,
	"cost" integer NOT NULL,
	CONSTRAINT "reward_household_id_id_pk" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "reward_redemption" (
	"household_id" text NOT NULL,
	"id" text NOT NULL,
	"ord" bigint GENERATED ALWAYS AS IDENTITY (sequence name "reward_redemption_ord_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"reward_id" text NOT NULL,
	"member_id" text NOT NULL,
	"status" text NOT NULL,
	"requested_at" text NOT NULL,
	CONSTRAINT "reward_redemption_household_id_id_pk" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "routine" (
	"household_id" text NOT NULL,
	"id" text NOT NULL,
	"ord" bigint GENERATED ALWAYS AS IDENTITY (sequence name "routine_ord_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"icon" text NOT NULL,
	"window_start" text NOT NULL,
	"window_end" text NOT NULL,
	CONSTRAINT "routine_household_id_id_pk" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "task" (
	"household_id" text NOT NULL,
	"id" text NOT NULL,
	"ord" bigint GENERATED ALWAYS AS IDENTITY (sequence name "task_ord_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"title" text NOT NULL,
	"icon" text NOT NULL,
	"points" integer NOT NULL,
	"routine_id" text,
	"days" smallint[] NOT NULL,
	"date" text,
	CONSTRAINT "task_household_id_id_pk" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "task_assignee" (
	"household_id" text NOT NULL,
	"task_id" text NOT NULL,
	"member_id" text NOT NULL,
	"pos" integer NOT NULL,
	CONSTRAINT "task_assignee_household_id_task_id_member_id_pk" PRIMARY KEY("household_id","task_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "task_completion" (
	"household_id" text NOT NULL,
	"task_id" text NOT NULL,
	"member_id" text NOT NULL,
	"occurrence_date" text NOT NULL,
	"ord" bigint GENERATED ALWAYS AS IDENTITY (sequence name "task_completion_ord_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"completed_at" text NOT NULL,
	CONSTRAINT "task_completion_household_id_task_id_member_id_occurrence_date_pk" PRIMARY KEY("household_id","task_id","member_id","occurrence_date")
);
--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_receipt" ADD CONSTRAINT "command_receipt_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_assignee" ADD CONSTRAINT "event_assignee_household_id_event_id_event_household_id_id_fk" FOREIGN KEY ("household_id","event_id") REFERENCES "public"."event"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list" ADD CONSTRAINT "list_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_item" ADD CONSTRAINT "list_item_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_visibility" ADD CONSTRAINT "list_visibility_household_id_list_id_list_household_id_id_fk" FOREIGN KEY ("household_id","list_id") REFERENCES "public"."list"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal" ADD CONSTRAINT "meal_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward" ADD CONSTRAINT "reward_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_redemption" ADD CONSTRAINT "reward_redemption_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine" ADD CONSTRAINT "routine_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignee" ADD CONSTRAINT "task_assignee_household_id_task_id_task_household_id_id_fk" FOREIGN KEY ("household_id","task_id") REFERENCES "public"."task"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_completion" ADD CONSTRAINT "task_completion_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;