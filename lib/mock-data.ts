import { Family, FamilyPerson, FocusRelatives } from "@/lib/types";

const families: Family[] = [
  {
    id: "family-akhmedov",
    slug: "akhmedov",
    title: "Род Ахмедовых",
    surname: "Ахмедовы",
    description:
      "Живой семейный архив рода: люди, ветви, документы, фотоальбомы и голосовые истории старших поколений.",
    region: "Баку, Губа, Дагестан",
    coverQuote:
      "Каждый человек в дереве должен иметь свою карточку памяти: фото, факты, историю и голос семьи.",
    stats: {
      people: 8,
      photos: 148,
      audio: 19,
      stories: 34,
      contributors: 6,
    },
    memberships: [
      { name: "Тимур Ахмедов", role: "owner" },
      { name: "Лейла Тимурова", role: "editor" },
      { name: "Ахмед Магомедов", role: "member" },
      { name: "Амина Ахмедова", role: "member" },
    ],
    digitizationQueue: [
      {
        title: "Оцифровать свадебный альбом 1986 года",
        owner: "Лейла Тимурова",
        status: "in_progress",
      },
      {
        title: "Записать рассказ Ахмеда о прадеде Магомеде",
        owner: "Тимур Ахмедов",
        status: "planned",
      },
      {
        title: "Добавить документы по линии Губы",
        owner: "Амина Ахмедова",
        status: "ready",
      },
    ],
    people: [
      {
        id: "magomed",
        firstName: "Магомед",
        lastName: "Ахмедов",
        gender: "male",
        birthDate: "1932",
        deathDate: "2004",
        birthPlace: "Губа",
        status: "deceased",
        isArchived: false,
        biography:
          "Старший хранитель рода. Собирал семейные письма, вел записи по датам рождения и рассказывал детям о предках.",
        timeline: [
          "1932 - рождение в Губе",
          "1956 - переезд семьи в Баку",
          "1988 - начал собирать семейные записи в тетради",
        ],
        media: { photos: 18, audio: 3, documents: 5 },
        mediaAssets: [],
        stories: [],
        memory: {
          title: "Что Магомед оставил семье",
          narrator: "Ахмед Магомедов",
          duration: "03:18",
          summary:
            "Рассказ сына о том, как Магомед сохранял имена, даты и семейные истории еще до цифрового архива.",
        },
      },
      {
        id: "zalikha",
        firstName: "Залиха",
        lastName: "Ахмедова",
        gender: "female",
        birthDate: "1938",
        deathDate: "2011",
        birthPlace: "Губа",
        status: "deceased",
        isArchived: false,
        biography:
          "Собирала семейные фотографии и хранила письма. Многие легенды рода дошли через ее рассказы детям и внукам.",
        timeline: [
          "1938 - рождение в Губе",
          "1961 - переезд в Баку",
          "2001 - собрала первый семейный фотоальбом",
        ],
        media: { photos: 24, audio: 4, documents: 2 },
        mediaAssets: [],
        stories: [],
      },
      {
        id: "ahmed",
        firstName: "Ахмед",
        lastName: "Ахмедов",
        middleName: "Магомедович",
        gender: "male",
        birthDate: "1964",
        birthPlace: "Баку",
        status: "living",
        isArchived: false,
        biography:
          "Связующее звено между старшим и молодым поколением. Помнит семейные легенды, знает происхождение веток рода.",
        timeline: [
          "1964 - рождение в Баку",
          "1986 - свадьба с Аминой",
          "2025 - начал записывать аудиоархив по старшему поколению",
        ],
        media: { photos: 21, audio: 5, documents: 4 },
        mediaAssets: [],
        stories: [],
        memory: {
          title: "Как семья жила в 1980-х",
          narrator: "Ахмед Магомедов",
          duration: "04:42",
          summary:
            "История о жизни семьи в Баку, соседях, быте и традициях, которые передавались детям.",
        },
      },
      {
        id: "amina",
        firstName: "Амина",
        lastName: "Ахмедова",
        gender: "female",
        birthDate: "1967",
        birthPlace: "Баку",
        status: "living",
        isArchived: false,
        biography:
          "Хранит семейный архив документов и знает, кому принадлежат старые фотографии без подписей.",
        timeline: [
          "1967 - рождение в Баку",
          "1986 - свадьба",
          "2024 - начала систематизировать семейные документы",
        ],
        media: { photos: 19, audio: 2, documents: 9 },
        mediaAssets: [],
        stories: [],
      },
      {
        id: "timur",
        firstName: "Тимур",
        lastName: "Ахмедов",
        middleName: "Ахмедович",
        gender: "male",
        birthDate: "1991",
        birthPlace: "Баку",
        status: "living",
        isArchived: false,
        biography:
          "Создатель цифрового архива семьи. Собирает структуру дерева, добавляет людей и выстраивает связи между поколениями.",
        note:
          "Для MVP нужен сценарий: добавить человека, выбрать связь, увидеть автоматические родства.",
        timeline: [
          "1991 - рождение в Баку",
          "2014 - свадьба",
          "2020 - началась оцифровка семейного архива",
          "2026 - добавлена ветка дочери Сафии",
        ],
        media: { photos: 17, audio: 2, documents: 3 },
        mediaAssets: [],
        stories: [],
        memory: {
          title: "Зачем мы строим семейный архив",
          narrator: "Тимур Ахмедов",
          duration: "02:11",
          summary:
            "Короткое объяснение идеи продукта: сохранить память рода и передавать ее следующим поколениям.",
        },
      },
      {
        id: "leyla",
        firstName: "Лейла",
        lastName: "Тимурова",
        gender: "female",
        birthDate: "1993",
        birthPlace: "Баку",
        status: "living",
        isArchived: false,
        biography:
          "Помогает собирать фотоархив, сканирует документы и отвечает за структурирование материалов по датам и веткам.",
        timeline: [
          "1993 - рождение в Баку",
          "2014 - свадьба с Тимуром",
          "2023 - начала цифровую сортировку фотографий семьи",
        ],
        media: { photos: 14, audio: 1, documents: 2 },
        mediaAssets: [],
        stories: [],
      },
      {
        id: "ilyas",
        firstName: "Ильяс",
        lastName: "Ахмедов",
        middleName: "Ахмедович",
        gender: "male",
        birthDate: "1997",
        birthPlace: "Баку",
        status: "living",
        isArchived: false,
        biography:
          "Младший брат Тимура. Помогает восстанавливать утерянные даты и искать документы по линии отца.",
        timeline: [
          "1997 - рождение в Баку",
          "2022 - начал собирать документы по ветке деда Магомеда",
        ],
        media: { photos: 11, audio: 0, documents: 2 },
        mediaAssets: [],
        stories: [],
      },
      {
        id: "safiya",
        firstName: "Сафия",
        lastName: "Ахмедова",
        gender: "female",
        birthDate: "2026",
        birthPlace: "Баку",
        status: "living",
        isArchived: false,
        biography:
          "Новая ветка дерева. Пример того, как после добавления ребенка система должна автоматически показать родство со всей семьей.",
        timeline: ["2026 - рождение в Баку", "2026 - добавлена в цифровое дерево семьи"],
        media: { photos: 6, audio: 0, documents: 1 },
        mediaAssets: [],
        stories: [],
      },
    ],
    relationships: [
      { type: "spouse", fromPersonId: "magomed", toPersonId: "zalikha" },
      { type: "spouse", fromPersonId: "ahmed", toPersonId: "amina" },
      { type: "spouse", fromPersonId: "timur", toPersonId: "leyla" },
      { type: "parent", fromPersonId: "magomed", toPersonId: "ahmed" },
      { type: "parent", fromPersonId: "zalikha", toPersonId: "ahmed" },
      { type: "parent", fromPersonId: "ahmed", toPersonId: "timur" },
      { type: "parent", fromPersonId: "amina", toPersonId: "timur" },
      { type: "parent", fromPersonId: "ahmed", toPersonId: "ilyas" },
      { type: "parent", fromPersonId: "amina", toPersonId: "ilyas" },
      { type: "parent", fromPersonId: "timur", toPersonId: "safiya" },
      { type: "parent", fromPersonId: "leyla", toPersonId: "safiya" },
    ],
    archivedPeople: [],
    auditLog: [],
  },
];

function getPersonMap(family: Family) {
  return new Map(family.people.map((person) => [person.id, person]));
}

export function getFamilies() {
  return families;
}

export function getFamilyBySlug(slug: string) {
  return families.find((family) => family.slug === slug);
}

export function getPersonFullName(person: FamilyPerson) {
  return [person.firstName, person.middleName, person.lastName]
    .filter(Boolean)
    .join(" ");
}

function uniquePeople(people: FamilyPerson[]) {
  return Array.from(new Map(people.map((person) => [person.id, person])).values());
}

export function getFocusRelatives(
  family: Family,
  focusPersonId: string,
): FocusRelatives {
  const personMap = getPersonMap(family);

  const parents = family.relationships
    .filter(
      (relationship) =>
        relationship.type === "parent" && relationship.toPersonId === focusPersonId,
    )
    .map((relationship) => personMap.get(relationship.fromPersonId))
    .filter((person): person is FamilyPerson => Boolean(person));

  const children = family.relationships
    .filter(
      (relationship) =>
        relationship.type === "parent" && relationship.fromPersonId === focusPersonId,
    )
    .map((relationship) => personMap.get(relationship.toPersonId))
    .filter((person): person is FamilyPerson => Boolean(person));

  const spouses = family.relationships
    .filter(
      (relationship) =>
        relationship.type === "spouse" &&
        (relationship.fromPersonId === focusPersonId ||
          relationship.toPersonId === focusPersonId),
    )
    .map((relationship) =>
      relationship.fromPersonId === focusPersonId
        ? personMap.get(relationship.toPersonId)
        : personMap.get(relationship.fromPersonId),
    )
    .filter((person): person is FamilyPerson => Boolean(person));

  const parentIds = new Set(parents.map((parent) => parent.id));

  const siblings = uniquePeople(
    family.relationships
      .filter(
        (relationship) =>
          relationship.type === "parent" && parentIds.has(relationship.fromPersonId),
      )
      .map((relationship) => personMap.get(relationship.toPersonId))
      .filter((person): person is FamilyPerson => Boolean(person))
      .filter((person) => person.id !== focusPersonId),
  );

  return { parents, spouses, siblings, children };
}
