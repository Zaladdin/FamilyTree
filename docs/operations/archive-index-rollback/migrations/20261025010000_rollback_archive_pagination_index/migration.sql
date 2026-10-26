-- Forward rollback: preserve historical migrations and remove only the archive index.
DROP INDEX public."Person_familyId_isArchived_id_idx" RESTRICT;
