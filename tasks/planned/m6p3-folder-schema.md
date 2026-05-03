# Folder schema + helpers + endpoints

**Why:** Backend foundation for phase 3. Folders are a UI organization layer over notes — pure UI, no edges/embeddings/provenance, opaque to the agent.
**What:** Add `note_folders(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, parent_id INTEGER NULL REFERENCES note_folders(id) ON DELETE CASCADE, sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000))`. Add `folder_id INTEGER NULL REFERENCES note_folders(id) ON DELETE SET NULL` column to `node_notes` (deleting a folder un-files its notes — they survive, never collateral). Helpers in `kg/db.ts`: `listFolders()` (returns flat array with parent_id; client builds the tree), `createFolder({name, parentId})`, `renameFolder(id, newName)`, `deleteFolder(id, mode: "unfile" | "cascade")`, `moveNote(nodeId, folderId | null)`, `reorderFolder(id, sortOrder)`. Folder name is unique per-parent: composite unique constraint `UNIQUE(parent_id, name)` (NULL parent = root). Endpoints under `/api/kg/folders`: `GET` (list all), `POST` (create), `PATCH /:id` (rename or move), `DELETE /:id?mode=unfile|cascade`. Note PATCH already exists (from m6p2-note-name-field) — extend its body to accept `folderId` for move-to-folder. `GET /api/kg/notes` response gains `folderId` field. Tree state (which folders are expanded in the sidebar) persists per-user in localStorage on the client side; no server table.
**Files:** `server/src/kg/db.ts`, `server/src/index.ts`, `server/src/seed.ts`, `web/src/lib/api.ts`
**Estimate:** medium — straightforward schema + CRUD; gotcha is the cascade vs SET NULL choice on the two FKs
**Dependencies:** m6p2-note-creation-flow
**Smoke steps:**
1. `npm run dev` (re-seeds) → console reports `4 notes`. Verify `note_folders` table exists with no rows; verify `node_notes.folder_id` is null for all 4 seeded notes.
2. `curl -X POST /api/kg/folders -H 'Content-Type: application/json' -d '{"name":"Personal","parentId":null}'` → returns the new folder. `GET /api/kg/folders` lists it.
3. `curl -X POST /api/kg/folders -d '{"name":"Pets","parentId":<personal-id>}'` → nested folder created.
4. `PATCH /api/kg/node/<snickers-id>/note -d '{"folderId":<pets-id>}'` → Snickers note's folder_id updates.
5. `DELETE /api/kg/folders/<personal-id>?mode=unfile` → folder + nested Pets folder deleted (cascade), Snickers note's folder_id resets to null (SET NULL behavior). Note row itself survives.
6. Re-create folders, this time `DELETE /api/kg/folders/<id>?mode=cascade` → folder gone, but FK is SET NULL not CASCADE, so notes still survive. Confirm helper does the right thing (cascade mode probably needs to manually delete child notes' rows; flag if the SET NULL FK behavior conflicts with the cascade-mode contract).
7. Unique constraint: try creating two folders with the same name + same parent → second insert fails with a clear error.

---

**Status:** pending
**Started:** —

## Notes
