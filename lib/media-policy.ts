const GIB = 1024 ** 3;

type QuotaEnvironment = Record<string, string | undefined>;

function readQuota(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error("Некорректный параметр квоты медиафайлов.");
  }
  return Number(value);
}

export function getMediaQuotas(environment: QuotaEnvironment = process.env) {
  return {
    familyBytes: readQuota(environment.MEDIA_FAMILY_QUOTA_BYTES, GIB),
    systemBytes: readQuota(environment.MEDIA_SYSTEM_QUOTA_BYTES, 10 * GIB),
  };
}
