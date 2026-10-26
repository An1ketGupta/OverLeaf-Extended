CREATE TABLE "ai_proposal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"data" jsonb NOT NULL,
	"context" jsonb NOT NULL,
	"bytes" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resume_analysis" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data" jsonb NOT NULL,
	"bytes" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_proposal" ADD CONSTRAINT "ai_proposal_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_proposal" ADD CONSTRAINT "ai_proposal_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_analysis" ADD CONSTRAINT "resume_analysis_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resume_analysis_user_idx" ON "resume_analysis" USING btree ("user_id");