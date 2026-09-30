# Rodovo — «Нить семьи»

Семейный архив как современная семейная книга. Тёплая бумага, графитная типографика, красная нить родства. Лендинг эмоциональный; рабочее дерево спокойное и функциональное. Georgia поддерживает кириллицу и не требует внешней загрузки шрифтов.

## Система

- Бумага `#f5f1e8`, лист `#fffcf5`, текст `#292a27`, акцент `#a33b36`.
- Общие элементы и адаптивность: `app/globals.css`.
- Главная и визуальная обложка: `app/landing.css`, `components/hero-tree.tsx`.
- Публичное демо `/demo` использует только вымышленные данные из mock-data. Настоящие семейные архивы по-прежнему требуют авторизацию.
- Фото на обложке — AI-иллюстрация, а не пользовательский семейный снимок. В карточках реальных людей не подставляются вымышленные портреты: отображаются инициалы или загруженные фото.
- Полотно: поиск людей, выбор мышью/клавиатурой, перетаскивание, масштаб, подгонка ветви, миникарта. Макет показывает ближайших родственников выбранного человека, не всё родословное дерево сразу.

## Иллюстрация

Файл: `public/images/family-memory.png`. Создан встроенным ImageGen. Оригинал сохранён в каталоге generated_images Codex; копия включена в проект.

Промпт:

> Create one photorealistic archival family photograph, landscape 4:3 composition, for an editorial Russian-language family-history website. A candid multigenerational family of seven fictional people including grandparents, two young adult couples and a child gathered closely at an outdoor wooden table under a leafy tree in a modest Caucasus courtyard circa 1968, worn plaster wall in background. Warm intimate natural expressions, some looking at camera and others at each other, carefully plausible anatomy and distinct faces. Authentic 1960s everyday clothes, documentary medium format photography, natural afternoon light, silver-gelatin black and white with very subtle warm aged paper tonality, fine analog grain, softly imperfect focus, rich graphite blacks, restrained contrast, small signs of faded print. The people and their connection are the subject, no luxury or staged stock photo smiles. Frame full image as photograph edge-to-edge, NO paper frame, NO typography, NO text, NO letters, NO watermark, NO red thread (we add graphic thread in code). This is an illustrative fictional family, not real user data. High-quality website hero bitmap asset.

## Безопасная проверка

`npx tsx --test tests/tree-viewport.test.ts tests/validation.test.ts tests/family-logic.test.ts`

Эти тесты не изменяют БД и файловый архив. После первого этапа исправлений общий `npm test` также безопасен: медиа-тест использует отдельный временный каталог, а интеграционные тесты БД вынесены в отдельную команду. Условия запуска описаны в `tests/README.md`.

Проверка реализации 13 сентября 2026:

- `npm run build` — успешно, включая проверку типов и lint.
- 11 безопасных unit-тестов — успешно (геометрия/масштаб, валидация, семейная логика).
- В браузере production-сборки: переход на `/demo`, поиск Амины, выбор результата с сохранением фокуса, масштаб, выбор Тимура клавишей Enter, перетаскивание и возврат к подогнанной ветви.
- Проверены desktop и viewport 390 × 844; горизонтального переполнения на главной, демо и регистрации нет. Фото обложки загрузилось.
- Настоящая регистрация, загрузка файлов и изменения в закрытых семейных архивах не выполнялись. Данные пользователя не изменялись.
- При первичной проверке CSP блокировала клиентские компоненты в `next dev`. В следующем этапе исправлений это устранено: `unsafe-eval` разрешён исключительно в development, production CSP осталась прежней. Теперь доступен и `npm run dev -- --hostname 127.0.0.1 --port 3000`.
