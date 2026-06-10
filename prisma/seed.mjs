import { PrismaClient } from "@prisma/client";
import { scryptSync, randomBytes } from "node:crypto";

const prisma = new PrismaClient();

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

const family = {
  id: "family-akhmedov",
  slug: "akhmedov",
  title: "Род Ахмедовых",
  surname: "Ахмедовы",
  description:
    "Живой семейный архив рода: люди, ветви, документы, фотоальбомы и голосовые истории старших поколений.",
  region: "Баку, Губа, Дагестан",
  coverQuote:
    "Каждый человек в дереве должен иметь свою карточку памяти: фото, факты, историю и голос семьи.",
  peopleCount: 8,
  photosCount: 148,
  audioCount: 19,
  storiesCount: 5,
  contributorsCount: 6,
};

const memberships = [
  { userId: "user-timur", name: "Тимур Ахмедов", role: "owner" },
  { userId: "user-leyla", name: "Лейла Тимурова", role: "editor" },
  { name: "Ахмед Магомедов", role: "member" },
  { name: "Амина Ахмедова", role: "member" },
];

const users = [
  {
    id: "user-timur",
    firstName: "Тимур",
    lastName: "Ахмедов",
    email: "timur@rodovo.app",
    passwordHash: hashPassword("12345678"),
  },
  {
    id: "user-leyla",
    firstName: "Лейла",
    lastName: "Тимурова",
    email: "leyla@rodovo.app",
    passwordHash: hashPassword("12345678"),
  },
];

const digitizationTasks = [
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
];

const people = [
  {
    id: "magomed",
    firstName: "Магомед",
    lastName: "Ахмедов",
    middleName: "",
    gender: "male",
    birthDate: "1932",
    deathDate: "2004",
    birthPlace: "Губа",
    status: "deceased",
    isArchived: false,
    biography:
      "Старший хранитель рода. Собирал семейные письма, вел записи по датам рождения и рассказывал детям о предках.",
    note: null,
    photosCount: 18,
    audioCount: 3,
    documentsCount: 5,
    memoryTitle: "Что Магомед оставил семье",
    memoryNarrator: "Ахмед Магомедов",
    memoryDuration: "03:18",
    memorySummary:
      "Рассказ сына о том, как Магомед сохранял имена, даты и семейные истории еще до цифрового архива.",
    timeline: [
      "1932 - рождение в Губе",
      "1956 - переезд семьи в Баку",
      "1988 - начал собирать семейные записи в тетради",
    ],
  },
  {
    id: "zalikha",
    firstName: "Залиха",
    lastName: "Ахмедова",
    middleName: "",
    gender: "female",
    birthDate: "1938",
    deathDate: "2011",
    birthPlace: "Губа",
    status: "deceased",
    isArchived: false,
    biography:
      "Собирала семейные фотографии и хранила письма. Многие легенды рода дошли через ее рассказы детям и внукам.",
    note: null,
    photosCount: 24,
    audioCount: 4,
    documentsCount: 2,
    memoryTitle: null,
    memoryNarrator: null,
    memoryDuration: null,
    memorySummary: null,
    timeline: [
      "1938 - рождение в Губе",
      "1961 - переезд в Баку",
      "2001 - собрала первый семейный фотоальбом",
    ],
  },
  {
    id: "ahmed",
    firstName: "Ахмед",
    lastName: "Ахмедов",
    middleName: "Магомедович",
    gender: "male",
    birthDate: "1964",
    deathDate: null,
    birthPlace: "Баку",
    status: "living",
    isArchived: false,
    biography:
      "Связующее звено между старшим и молодым поколением. Помнит семейные легенды, знает происхождение веток рода.",
    note: null,
    photosCount: 21,
    audioCount: 5,
    documentsCount: 4,
    memoryTitle: "Как семья жила в 1980-х",
    memoryNarrator: "Ахмед Магомедов",
    memoryDuration: "04:42",
    memorySummary:
      "История о жизни семьи в Баку, соседях, быте и традициях, которые передавались детям.",
    timeline: [
      "1964 - рождение в Баку",
      "1986 - свадьба с Аминой",
      "2025 - начал записывать аудиоархив по старшему поколению",
    ],
  },
  {
    id: "amina",
    firstName: "Амина",
    lastName: "Ахмедова",
    middleName: "",
    gender: "female",
    birthDate: "1967",
    deathDate: null,
    birthPlace: "Баку",
    status: "living",
    isArchived: false,
    biography:
      "Хранит семейный архив документов и знает, кому принадлежат старые фотографии без подписей.",
    note: null,
    photosCount: 19,
    audioCount: 2,
    documentsCount: 9,
    memoryTitle: null,
    memoryNarrator: null,
    memoryDuration: null,
    memorySummary: null,
    timeline: [
      "1967 - рождение в Баку",
      "1986 - свадьба",
      "2024 - начала систематизировать семейные документы",
    ],
  },
  {
    id: "timur",
    firstName: "Тимур",
    lastName: "Ахмедов",
    middleName: "Ахмедович",
    gender: "male",
    birthDate: "1991",
    deathDate: null,
    birthPlace: "Баку",
    status: "living",
    isArchived: false,
    biography:
      "Создатель цифрового архива семьи. Собирает структуру дерева, добавляет людей и выстраивает связи между поколениями.",
    note:
      "Для MVP нужен сценарий: добавить человека, выбрать связь, увидеть автоматические родства.",
    photosCount: 17,
    audioCount: 2,
    documentsCount: 3,
    memoryTitle: "Зачем мы строим семейный архив",
    memoryNarrator: "Тимур Ахмедов",
    memoryDuration: "02:11",
    memorySummary:
      "Короткое объяснение идеи продукта: сохранить память рода и передавать ее следующим поколениям.",
    timeline: [
      "1991 - рождение в Баку",
      "2014 - свадьба",
      "2020 - началась оцифровка семейного архива",
      "2026 - добавлена ветка дочери Сафии",
    ],
  },
  {
    id: "leyla",
    firstName: "Лейла",
    lastName: "Тимурова",
    middleName: "",
    gender: "female",
    birthDate: "1993",
    deathDate: null,
    birthPlace: "Баку",
    status: "living",
    isArchived: false,
    biography:
      "Помогает собирать фотоархив, сканирует документы и отвечает за структурирование материалов по датам и веткам.",
    note: null,
    photosCount: 14,
    audioCount: 1,
    documentsCount: 2,
    memoryTitle: null,
    memoryNarrator: null,
    memoryDuration: null,
    memorySummary: null,
    timeline: [
      "1993 - рождение в Баку",
      "2014 - свадьба с Тимуром",
      "2023 - начала цифровую сортировку фотографий семьи",
    ],
  },
  {
    id: "ilyas",
    firstName: "Ильяс",
    lastName: "Ахмедов",
    middleName: "Ахмедович",
    gender: "male",
    birthDate: "1997",
    deathDate: null,
    birthPlace: "Баку",
    status: "living",
    isArchived: false,
    biography:
      "Младший брат Тимура. Помогает восстанавливать утерянные даты и искать документы по линии отца.",
    note: null,
    photosCount: 11,
    audioCount: 0,
    documentsCount: 2,
    memoryTitle: null,
    memoryNarrator: null,
    memoryDuration: null,
    memorySummary: null,
    timeline: [
      "1997 - рождение в Баку",
      "2022 - начал собирать документы по ветке деда Магомеда",
    ],
  },
  {
    id: "safiya",
    firstName: "Сафия",
    lastName: "Ахмедова",
    middleName: "",
    gender: "female",
    birthDate: "2026",
    deathDate: null,
    birthPlace: "Баку",
    status: "living",
    isArchived: false,
    biography:
      "Новая ветка дерева. Пример того, как после добавления ребенка система должна автоматически показать родство со всей семьей.",
    note: null,
    photosCount: 6,
    audioCount: 0,
    documentsCount: 1,
    memoryTitle: null,
    memoryNarrator: null,
    memoryDuration: null,
    memorySummary: null,
    timeline: [
      "2026 - рождение в Баку",
      "2026 - добавлена в цифровое дерево семьи",
    ],
  },
];

const relationships = [
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
];

const stories = [
  {
    personId: "magomed",
    title: "Как прадед записывал имена рода",
    body:
      "Магомед держал отдельную тетрадь, где по вечерам записывал имена новорожденных, даты свадеб и имена старших по каждой ветке семьи.",
    narrator: "Ахмед Магомедов",
  },
  {
    personId: "zalikha",
    title: "Фотоальбом без подписей",
    body:
      "Залиха умела по лицам и одежде узнавать, в каком году сделан снимок и кто на нем стоит, даже если на обороте не было ни одной подписи.",
    narrator: "Амина Ахмедова",
  },
  {
    personId: "ahmed",
    title: "История переезда в Баку",
    body:
      "Ахмед вспоминает, как семья меняла дом, работу и привычный уклад, но старалась сохранить родственные связи и встречи по праздникам.",
    narrator: "Ахмед Магомедов",
  },
  {
    personId: "timur",
    title: "Почему появился цифровой архив",
    body:
      "Идея началась с желания не потерять голоса старших и не оставлять семейные фотографии в коробках без истории и имен.",
    narrator: "Тимур Ахмедов",
  },
  {
    personId: "safiya",
    title: "Первая запись для новой ветки",
    body:
      "Сафия стала примером того, как новая ветка семьи сразу получает место в дереве, фотографии и первые истории от родителей.",
    narrator: "Лейла Тимурова",
  },
];

const auditLogs = [
  {
    action: "person_created",
    actorName: "Тимур Ахмедов",
    personId: "safiya",
    personName: "Сафия Ахмедова",
    message: 'Тимур Ахмедов добавил(а) человека "Сафия Ахмедова" в семейное дерево.',
  },
  {
    action: "media_added",
    actorName: "Лейла Тимурова",
    personId: "timur",
    personName: "Тимур Ахмедович Ахмедов",
    message: 'Лейла Тимурова добавил(а) фото в карточку "Тимур Ахмедович Ахмедов".',
  },
  {
    action: "person_updated",
    actorName: "Тимур Ахмедов",
    personId: "ahmed",
    personName: "Ахмед Магомедович Ахмедов",
    message: 'Тимур Ахмедов обновил(а) карточку человека "Ахмед Магомедович Ахмедов".',
  },
];

async function main() {
  await prisma.session.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.relationship.deleteMany();
  await prisma.story.deleteMany();
  await prisma.timelineEvent.deleteMany();
  await prisma.person.deleteMany();
  await prisma.digitizationTask.deleteMany();
  await prisma.familyMembership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.family.deleteMany();

  await prisma.user.createMany({
    data: users,
  });

  await prisma.family.create({
    data: {
      ...family,
      memberships: {
        create: memberships,
      },
      digitizationTasks: {
        create: digitizationTasks,
      },
      auditLogs: {
        create: auditLogs,
      },
      people: {
        create: people.map((person) => ({
          id: person.id,
          firstName: person.firstName,
          lastName: person.lastName,
          middleName: person.middleName,
          gender: person.gender,
          birthDate: person.birthDate,
          deathDate: person.deathDate,
          birthPlace: person.birthPlace,
          status: person.status,
          isArchived: person.isArchived,
          biography: person.biography,
          note: person.note,
          photosCount: person.photosCount,
          audioCount: person.audioCount,
          documentsCount: person.documentsCount,
          memoryTitle: person.memoryTitle,
          memoryNarrator: person.memoryNarrator,
          memoryDuration: person.memoryDuration,
          memorySummary: person.memorySummary,
          timelineEvents: {
            create: person.timeline.map((label, index) => ({
              label,
              order: index,
            })),
          },
        })),
      },
    },
  });

  await prisma.relationship.createMany({
    data: relationships.map((relationship) => ({
      familyId: family.id,
      ...relationship,
    })),
  });

  await prisma.story.createMany({
    data: stories,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
