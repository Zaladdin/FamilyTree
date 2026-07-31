// Transliterate Cyrillic / Azerbaijani letters to Latin so generated slugs and
// ids are always URL-safe ASCII. Cyrillic in URLs depends on percent-encoding
// and breaks slug matching (e.g. /family/<cyrillic>), so we avoid it entirely.
const TO_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  ə: "e", ğ: "g", ı: "i", ö: "o", ş: "sh", ü: "u", ç: "ch",
};

export function transliterate(value: string): string {
  let result = "";

  for (const char of value.toLowerCase()) {
    result += TO_LATIN[char] ?? char;
  }

  return result;
}

// Produces a URL-safe ASCII slug: transliterated, lowercased, non-alphanumerics
// collapsed to single hyphens, no leading/trailing hyphens.
export function slugify(value: string): string {
  return transliterate(value.trim())
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
