-- Supports tenant-scoped active summaries and archived-person keyset pages.
CREATE INDEX "Person_familyId_isArchived_id_idx" ON "Person"("familyId", "isArchived", "id");
