CREATE TABLE "snapshot_name" (
	"snapshot_id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "snapshot_name" ADD CONSTRAINT "snapshot_name_snapshot_id_project_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."project_snapshot"("id") ON DELETE cascade ON UPDATE no action;