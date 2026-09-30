-- Synthetic fixture only, applied exclusively by guarded legacy-upgrade.ts.
INSERT INTO "User" (id, "firstName", "lastName", email, "passwordHash", "updatedAt") VALUES ('legacy-user', 'Тест', 'Старый', 'legacy@example.invalid', 'synthetic-unusable-hash', '2026-01-02');
INSERT INTO "Family" (id, slug, title, surname, description, region, "coverQuote", "peopleCount", "photosCount", "audioCount", "storiesCount", "contributorsCount", "updatedAt") VALUES ('legacy-family', 'synthetic-upgrade', 'Тестовая семья', 'Тест', 'Синтетические данные', 'Тест', 'Цитата', 3, 1, 1, 1, 1, '2026-01-02');
INSERT INTO "FamilyMembership" (id, "familyId", "userId", name, role, "updatedAt") VALUES ('legacy-member', 'legacy-family', 'legacy-user', 'Тест Старый', 'owner', '2026-01-02');
INSERT INTO "DigitizationTask" (id, "familyId", title, owner, status, "updatedAt") VALUES ('legacy-task', 'legacy-family', 'Сканирование', 'Тест', 'planned', '2026-01-02');
INSERT INTO "Person" (id, "familyId", "firstName", "lastName", gender, "birthDate", "deathDate", "birthPlace", status, "isArchived", biography, note, "createdAt", "updatedAt") VALUES
('legacy-father', 'legacy-family', 'Отец', 'Тест', 'male', '1951', '2020', 'Город', 'deceased', true, 'Биография', 'Заметка', '2026-01-01', '2026-01-02'),
('legacy-mother', 'legacy-family', 'Мать', 'Тест', 'female', '1952', NULL, 'Город', 'living', false, 'Биография матери', NULL, '2026-01-01', '2026-01-02'),
('legacy-child', 'legacy-family', 'Ребёнок', 'Тест', 'female', '1980-03', NULL, 'Город', 'living', false, 'Биография ребёнка', NULL, '2026-01-01', '2026-01-02');
UPDATE "Person" SET "photosCount" = 1 WHERE id = 'legacy-father';
UPDATE "Person" SET "audioCount" = 1 WHERE id = 'legacy-child';
INSERT INTO "Relationship" (id, "familyId", "fromPersonId", "toPersonId", type, "updatedAt") VALUES
('legacy-spouse', 'legacy-family', 'legacy-father', 'legacy-mother', 'spouse', '2026-01-02'),
('legacy-parent', 'legacy-family', 'legacy-father', 'legacy-child', 'parent', '2026-01-02');
INSERT INTO "Story" (id, "personId", title, body, narrator, "updatedAt") VALUES ('legacy-story', 'legacy-father', 'История', 'Сохранить весь текст истории.', 'Рассказчик', '2026-01-02');
INSERT INTO "TimelineEvent" (id, "personId", label, "order", "createdAt", "updatedAt") VALUES
('timeline-birth', 'legacy-father', '1950 - рождение', 0, '2026-01-01', '2026-01-02'),
('timeline-added', 'legacy-father', '2026 - добавлен(а) в цифровое дерево семьи', 1, '2026-01-01', '2026-01-02'),
('timeline-custom', 'legacy-father', '1975 - переезд', 2, '2026-01-01', '2026-01-02'),
('timeline-unmatched', 'legacy-mother', '1952 - рождение', 0, '2026-01-01', '2026-01-02');
INSERT INTO "MediaAsset" (id, "personId", type, title, "storagePath", "mimeType", size, "updatedAt") VALUES
('legacy-photo', 'legacy-father', 'photo', 'Фото', 'synthetic/photo.jpg', 'image/jpeg', 123, '2026-01-02'),
('legacy-audio', 'legacy-child', 'audio', 'Аудио', 'synthetic/audio.mp3', 'audio/mpeg', 456, '2026-01-02');
INSERT INTO "AuditLog" (id, "familyId", action, "actorName", "personId", "personName", message, "updatedAt") VALUES ('legacy-audit', 'legacy-family', 'member_added', 'Тест', 'legacy-father', 'Отец Тест', 'Синтетический журнал', '2026-01-02');
