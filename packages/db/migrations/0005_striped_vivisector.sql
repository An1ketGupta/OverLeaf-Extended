CREATE TABLE "project_asset" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"path" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"sha256" text NOT NULL,
	"media_type" text NOT NULL,
	"data" "bytea" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_snapshot" ADD COLUMN "assets" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "project_asset" ADD CONSTRAINT "project_asset_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_asset_path_idx" ON "project_asset" USING btree ("project_id","path");