# Source backup and recovery

Use **Export project (.zip)** from the workspace, or **Export saved project**
before project deletion. Workspace export saves pending text and verifies that
the full saved tree still matches this tab. Resolve conflicts, recovery drafts
and unseen remote edits first. The ZIP records one consistent revision and includes
all source and asset bytes; it consumes no history slot. A full history therefore
does not prevent source backup. Unsaved individual buffers can also be downloaded.

Keep the ZIP in a private location outside this application's database and browser
profile. It contains document contents. This app does not encrypt the archive or
automatically create off-device backups. Downloaded PDFs are separate artifacts.

To recover, sign in, open **Projects**, select **Project backup ZIP**, enter a
**Recovered project name**, and select **Import project backup**. This creates
a new private project and opens it. Check source paths, main file and images, then
compile and inspect the PDF. Existing projects are never overwritten. After a
connection interruption, refresh Projects to check whether import committed before
trying again; another submission can create another independent copy.

The local browser drill exports a nested Unicode/image tree with 20 retained
snapshots, deletes its synthetic original, imports its ZIP, compares every source
and asset byte, and compiles the recovered project through the actual engine.
Independent compile runs need not produce identical PDF hashes.

Supported archives are this app's stored ZIP32 exports with v1 snapshot or v2
ephemeral-capture manifests. The importer bounds archive bytes (9 MiB), entries
(50 source/assets plus manifest), decoded project bytes (8 MiB), UTF-8 source
(256 KiB/file), assets (2 MiB each), paths and metadata. It rejects compressed,
encrypted, directory/special/symlink entries, local/central mismatches, duplicate
names, extra/missing files, traversal, corrupt CRCs/hashes and invalid trees.
The server revalidates source, asset signatures, project/account quotas and hashes
in a transaction. A hash in a user-supplied archive is not proof of authenticity.

An archive restores one source revision. It does not restore account credentials,
sessions, complete history, snapshot labels, AI requests, reports or retained PDFs.
Imported file/project IDs and versions are fresh. A source deletion backup in
History still retains those bytes until its project is deleted. Independently
saved resume reports survive project deletion and can be deleted separately.

## Limits and recovery choices

At 20 history rows/project or 32 MiB account snapshot JSON, creating another safety
snapshot may fail. File/asset deletion, restore and AI apply must then stop before
changing source if preservation cannot fit. Existing captured revisions can be
reused. Export the current source and import a fresh copy if you need a new history
budget; retain the original until recovery is checked. No history is silently
pruned. Full-account asset/project quotas can still prevent importing another copy.

The account asset limit is 32 MiB; project limits are 8 MiB and 50 combined entries.
Delete unwanted projects to release their retained assets/history after exporting
anything needed. Removing a live file alone does not erase its history. AI requests
reserve 200,000 bytes each against an 8 MiB budget (41 fit; the 50-request guard is
therefore not normally reached). Delete unwanted requests to free that space;
their safety snapshots remain. Reports have independent 20-count/8 MiB bounds;
deleting a report frees its capacity without changing the current local analysis.

Source that expands above the compiler's 16 MiB encoded transport cap remains
exportable through the separate 50 MiB encoded backup capture. Reduce the source
or assets before compiling; increasing export capacity does not relax execution
limits. Quota bytes are logical measures, not PostgreSQL disk usage. Physical use
includes compression, indexes, table overhead and dead tuples.

## Whole-database recovery procedure and unverified drill

Source ZIPs are not complete database backups. A full backup needs PostgreSQL's
native pg_dump/pg_restore (compatible with the server major version), an encrypted
private destination, and separately protected deployment configuration/secrets.
Use server environment variables for connection credentials; do not put URLs or
passwords in committed scripts, logs or shell history.

The intended drill is to create a separately named disposable source database
containing only synthetic fixtures, migrate/populate it, take a custom-format
dump, create another fresh disposable destination, and restore with
`pg_restore --exit-on-error --no-owner --no-acl`. Compare projects, source/asset
hashes, immutable history, proposals and reports; start an isolated API against
that destination and verify signin/source reads and compilation. Record migration
and runtime versions with the backup. Never restore over development, the existing
test database or a user database; do not use reset, schema push or `--clean` as a
shortcut. A genuine user backup needs a separately authorized retention/storage
and restoration procedure.

The available local embedded PostgreSQL package supplies postgres/pg_ctl but no
pg_dump/pg_restore executable, and none is on PATH. This full-database drill was
not executed. Application source ZIP recovery is demonstrated separately; do not
describe it as recovery of the entire database or an off-device disaster drill.
