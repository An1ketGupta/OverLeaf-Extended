CREATE TABLE "project_snapshot" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"main_file" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"files" jsonb NOT NULL,
	"bytes" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_snapshot" ADD CONSTRAINT "project_snapshot_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_snapshot_revision_idx" ON "project_snapshot" USING btree ("project_id","revision");
--> statement-breakpoint
-- Custom invariant: snapshot contents cannot be changed after insertion.
-- Deletes remain available to the owning project's/account's cascade lifecycle.
CREATE FUNCTION reject_project_snapshot_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Source snapshots are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER project_snapshot_immutable BEFORE UPDATE ON project_snapshot
FOR EACH ROW EXECUTE FUNCTION reject_project_snapshot_update();
