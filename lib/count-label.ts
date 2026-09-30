const russianPluralRules = new Intl.PluralRules("ru");

export function countNoun(count: number, one: string, few: string, many: string) {
  const category = russianPluralRules.select(count);
  return category === "one" ? one : category === "few" ? few : many;
}
