-- Explicit siblings can be recorded without inventing unknown parent records.
-- Additive only: all existing enum values, people and relationships are retained.
ALTER TYPE "RelationshipType" ADD VALUE IF NOT EXISTS 'sibling';
