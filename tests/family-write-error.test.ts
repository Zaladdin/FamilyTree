import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { HttpError } from "@/lib/http-error";
import { familyWriteErrorResponse, SIBLING_SCHEMA_NOT_READY_MESSAGE } from "@/lib/family-write-error";

const options = { fallback: "Не удалось сохранить.", invalidJson: "Некорректный JSON." };
const diagnostic = 'invalid input value for enum "RelationshipType": "sibling"';
const unknownError = (message: string) => new Prisma.PrismaClientUnknownRequestError(message, { clientVersion: "unit" });

test("missing sibling enum maps Prisma connector diagnostics to a fixed safe 503 contract", () => {
  for (const error of [
    unknownError(`Invalid prisma.relationship.createMany() invocation: ConnectorError(PostgresError { code: "22P02", message: "${diagnostic.replaceAll('"', '\\"')}" })`),
    new Prisma.PrismaClientKnownRequestError("Private SQL details", { code: "P2010", clientVersion: "unit", meta: { code: "22P02", message: diagnostic } }),
  ]) {
    assert.deepEqual(familyWriteErrorResponse(error, options), {
      status: 503, body: { error: SIBLING_SCHEMA_NOT_READY_MESSAGE, code: "SIBLING_SCHEMA_NOT_READY" },
    });
  }
});

test("unrelated enums, enum values, SQL errors and non-Prisma errors never become schema readiness errors", () => {
  for (const error of [
    unknownError(`PostgresError { code: "22P02", message: '${diagnostic.replace("sibling", "parent")}' }`),
    unknownError(`PostgresError { code: "22P02", message: '${diagnostic.replace("RelationshipType", "OtherType")}' }`),
    unknownError(`PostgresError { code: "23505", message: '${diagnostic}' }`),
    unknownError("Private SQL: sibling 22P02 RelationshipType"),
    new Error(`PostgresError { code: "22P02", message: '${diagnostic}' }`),
    new Prisma.PrismaClientValidationError(diagnostic, { clientVersion: "unit" }),
    new Prisma.PrismaClientKnownRequestError("Private SQL details", { code: "P2010", clientVersion: "unit", meta: { code: "23505", message: diagnostic } }),
    new HttpError(503, "Private database details"),
    "private detail",
    null,
  ]) assert.deepEqual(familyWriteErrorResponse(error, options), { status: 500, body: { error: options.fallback } });
});

test("deliberate client errors retain actionable messages and syntax errors use a safe message", () => {
  for (const status of [400, 401, 403, 404, 409]) {
    assert.deepEqual(familyWriteErrorResponse(new HttpError(status, "Проверьте данные."), options), {
      status, body: { error: "Проверьте данные." },
    });
  }
  assert.deepEqual(familyWriteErrorResponse(new SyntaxError("Private body fragment"), options), {
    status: 400, body: { error: options.invalidJson },
  });
});
