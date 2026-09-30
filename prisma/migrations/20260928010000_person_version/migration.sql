-- Existing cards start at revision 0; every card edit/archive/restore advances it.
ALTER TABLE "Person" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
