# FamilyTree üçün ECC istifadə bələdçisi

Yoxlama tarixi: 14 sentyabr 2026. Layihə: `E:\FamilyTree`.

ECC kod yazmağı, testləri, araşdırmanı və müstəqil yoxlamanı ardıcıl iş prosesinə çevirən açıq mənbəli təlimatlar toplusudur. Yeni model və ya bütün səhvləri avtomatik aradan qaldıran sistem deyil. Bacarıqlar düzgün istifadə olunanda işi nizamlayır; layihənin qaydalarını, icazələri və real yoxlamaları əvəz etmir.

## 1. Nə quraşdırılıb, nə aktiv deyil?

| Hissə | Vəziyyət |
|---|---|
| ECC mənbəyi | `C:\Users\Zaladdin\.codex\vendor\ecc` ünvanına endirilib; aşağıdakı commit-ə bağlanıb |
| Native Codex plaqini | `ecc@ecc`, versiya `2.2.1`, yerli marketplace mənbəyindən quraşdırılıb |
| Bacarıqlar | 292 əsas skill + quraşdırıcının uyğunlaşdırdığı 35 command-skill; Codex 327-ni səhvsiz tanıdı, hamısı eyni anda kontekstə yüklənmir |
| Native agent adapterləri | 68 mənbə agenti üçün `C:\Users\Zaladdin\.codex\agents\ecc-<mənbə-adı>.toml` yaradılıb; native konfiqurasiya yoxlaması xəbərdarlıqsız keçir |
| ECC Chrome DevTools MCP | Plaqin konfiqurasiyasındakı ayrıca seçimlə söndürülüb |
| ECC SessionStart hook | Dəqiq hook açarı ilə açıq şəkildə söndürülüb; etibarı da təsdiqlənməyib |
| Əlavə inteqrasiyalar | Yeni MCP hesabları, API açarları, qlobal Git hook-ları və legacy sync qurulmayıb |

Sabit mənbə commit-i: `8321021c54d670126ce3b2969d5deb880b4b0c2a`. İlkin Codex konfiqurasiya ehtiyatı: `C:\Users\Zaladdin\.codex\backups\ecc-2026-09-14\config.toml`.

“Endirilib”, “quraşdırılıb” və “tapşırığı uğurla yerinə yetirir” ayrı nəticələrdir. Native `skills/list` yoxlaması 327 aktiv ECC qeydini səhvsiz qaytardı; `doctor` konfiqurasiyanı qəbul etdi; `hooks/list` hook-un söndürüldüyünü təsdiqlədi. Bütün 68 agentə ayrıca model tapşırığı verilməyib və hamısının davranış keyfiyyəti sınaqdan keçirilmiş sayılmır.

`doctor` hesabatının bütövlükdə tam yaşıl olduğu iddia edilmir: qeyri-interaktiv yoxlama terminalında `TERM=dumb` xətası və Windows mühiti tövsiyələri var. ECC-yə aid konfiqurasiya yüklənməsi isə `ok` nəticəsi verib.

Quraşdırmadan sonra yeni söhbət və ya CLI sessiyası ən etibarlı başlanğıcdır. Mövcud söhbətdə növbəti mesajda kataloq yenilənə bilər, lakin buna zəmanət yoxdur. Bacarıq görünmürsə əvvəl yeni sessiya açın, lazım gələrsə tətbiqi yenidən başladın. [OpenAI: plaqinlərin istifadəsi](https://learn.chatgpt.com/docs/plugins)

## 2. Kataloqda nə var?

Yoxlanmış mənbədə 292 `SKILL.md`, 68 agent Markdown faylı və 94 command faylı var. Ayrıca Codex-facing `.agents/skills` qovluğunda 39 bacarıq, upstream `.codex/agents` daxilində isə üç nümunə rol mövcuddur. Bizim 68 adapterlik yanaşmamız həmin üç nümunədən fərqlidir.

Əsas sahələr: frontend və dizayn, proqramlaşdırma dilləri, test və review, verilənlər bazası, təhlükəsizlik, DevOps, agentlərin koordinasiyası, araşdırma, məzmun, sənədlər, media və maşın öyrənməsi. Qaydalar 22 qovluğa bölünüb; `rules/` altında 122 Markdown faylı sayılıb. Köhnə mətnlərdə 281 və ya 32 kimi rəqəmlər görünə bilər; bu bələdçi faktiki fayl sayına əsaslanır. [Yoxlanmış ECC mənbəyi](https://github.com/affaan-m/ECC/tree/8321021c54d670126ce3b2969d5deb880b4b0c2a)

FamilyTree üçün bütün kataloqu gündəlik işə qoşmaq lazım deyil. Əvvəl konkret tapşırığa uyğun iki-üç bacarıq seçmək daha məqsədəuyğundur.

## 3. Bacarıq, agent və command fərqi

**Bacarıq** işin necə aparılacağını izah edən təlimatdır: məsələn, `tdd-workflow` əvvəl səhvi göstərən test yazmağı təşkil edir. **Agent** ayrılmış işi yerinə yetirən ayrıca icraçıdır: məsələn, biri dəyişiklik edir, digəri nəticəni müstəqil yoxlayır. **Command** isə iş prosesinə giriş mətnidir; ECC-dəki `/plan` və `/code-review` kimi bütün slash-adların Codex interfeysində avtomatik komanda kimi işləyəcəyi nəzərdə tutulmur.

Native quraşdırıcı 35 command şablonunu `ecc:source-command-*` bacarığına çevirib: məsələn, `source-command-build-fix`. Bunlar plaqin keşində `.codex-plugin/migrated-command-skills/` daxilindədir; mənbədəki 94 command-ın hamısı ayrıca native komanda deyil.

Adapterlər upstream agent təlimatına istinad edir, mövcud model seçimini və hazırkı alətləri istifadə edir. Claude mətnindəki `opus`, `sonnet`, `Task` və `Bash` adları yeni model və ya alət quraşdırmaq göstərişi deyil. 68 adapter 68 agentin eyni anda işləməsi demək deyil; paralellik sessiyanın imkanları ilə məhdudlaşır. [OpenAI: native agent tərifi](https://learn.chatgpt.com/docs/agent-configuration/subagents)

Bacarıqları adı ilə istəmək olar: “ECC-nin `browser-qa` bacarığından istifadə et”. CLI/IDE-də `$` və `/skills`, tətbiqin uyğun seçim panelində isə göstərilən ad istifadə edilir. Siyahı böyük olduqda Codex təsvirləri qısalda və bəzi bacarıqları ilkin siyahıdan çıxara bilər. Bu halda dəqiq adı və ya `C:\Users\Zaladdin\.codex\vendor\ecc\skills\browser-qa\SKILL.md` kimi mənbə yolunu göstərin. Tam təlimat yalnız seçildikdə oxunur. [OpenAI: bacarıqlar və kontekst büdcəsi](https://learn.chatgpt.com/docs/build-skills)

## 4. FamilyTree üçün praktik seçim

| İş | Uyğun bacarıqlar və rollar |
|---|---|
| İşləməyən düymə, yanlış son vəziyyət | `click-path-audit`, `tdd-workflow`, `ecc-silent-failure-hunter` |
| React formaları və ağac seçimi | `react-patterns`, `frontend-a11y`, `ecc-react-reviewer` |
| TypeScript və async səhvləri | `coding-standards`, `error-handling`, `ecc-typescript-reviewer` |
| Prisma əlaqələri və tranzaksiyalar | `prisma-patterns`, `database-migrations`, `ecc-database-reviewer` |
| API və ailə icazələri | `api-design`, `security-review`; geniş audit üçün mövcud Codex Security |
| Vizual və mobil yoxlama | `browser-qa`, `design-system`; mövcud CUA brauzeri |
| Testlərin həqiqi faydası | `react-testing`, `e2e-testing`, `ecc-pr-test-analyzer` |
| Böyük ağacın sürəti | `react-performance`, `ecc-performance-optimizer` |
| Sonda nəticənin təsdiqi | `verification-loop`, `ecc-code-reviewer` |

Agent adlarını çağırmazdan əvvəl yeni sessiyada tanındığını yoxlamaq lazımdır. Tanınmayan rol varsa, Codex bunu deməli, adı mövcudmuş kimi nəticə uydurmamalıdır.

## 5. Hazır sorğu nümunələri

**Əlaqə səhvi:**

> `tdd-workflow` və `click-path-audit` ilə ana əlavə ediləndə ana–uşaq əlaqəsinin yaranmaması səhvini əvvəl testdə təkrarla. Sonra minimum dəyişikliklə düzəlt və eyni səhvin qayıtmadığını yoxla. Real ailə məlumatlarına toxunma.

**Mini-forma:**

> `frontend-a11y` və `react-patterns` ilə insan əlavə etmə mini-formasını yoxla: ilkin fokus, Tab sırası, Escape, səhv mesajları və mobil görünüş. Mövcud dizaynı və qohumluq istiqamətini qoru.

**Düymələr və keçidlər:**

> `browser-qa` ilə demo səhifəsini 375, 768 və 1440 piksel enlərində yoxla. Hansı düymə və keçidin işləmədiyini dəqiq göstər. Məlumat yaradan sınaqları yalnız təcrid olunmuş test mühitində apar.

**Müstəqil review:**

> `ecc-typescript-reviewer`, `ecc-react-reviewer` və `ecc-pr-test-analyzer` mövcuddursa, son dəyişiklikləri ayrı-ayrı yoxlasınlar. Real səhvləri, təsirini və təkrarlama addımlarını göstər. Review zamanı kodu dəyişmə.

**Verilənlər bazası:**

> `prisma-patterns` ilə ailələrarası məlumat izolyasiyasını və valideyn əlaqələrinin saxlanmasını yalnız oxuma rejimində təhlil et. Miqrasiya, seed və istehsal bazasına yazma əməliyyatı etmə.

**Buraxılışdan əvvəl:**

> `verification-loop` yanaşmasını layihəyə uyğunlaşdır: mövcud test, typecheck, lint və build əmrlərini istifadə et. İşlətmədiyin yoxlamanı uğurlu kimi göstərmə; ölçülməmiş test əhatəsi faizi yazma.

Yeni funksiya üçün `orch-add-feature`, işləməyən davranış üçün `orch-fix-defect`, işləyən davranışın dəyişməsi üçün `orch-change-feature` uyğundur. Bu ssenarilərdə plan və commit təsdiqi kimi dayanacaqlar ola bilər. “Plan hazırla, təsdiqimdən əvvəl kodu dəyişmə” və ya “Düzəlt, lakin commit/push etmə” sərhədini açıq yazın.

## 6. Windows və layihə uyğunluğu

FamilyTree hazırda Next.js `15.3.3`, React `19.1.0`, TypeScript `5.8.3`, Prisma `6.8.2` istifadə edir. `nextjs-turbopack` əsasən Next 16+ üçündür: oradakı yeni versiya qaydalarını bu layihəyə avtomatik tətbiq etmək olmaz. Prisma nümunələri də quraşdırılmış versiyaya uyğun yoxlanmalıdır.

ECC mətnlərindəki `head`, `tail`, `grep`, `set -o pipefail` PowerShell əmrləri deyil. Məqsəd saxlanmalı, əmr yerli mühitə uyğunlaşdırılmalıdır. `dmux`, tmux və bəzi uzunmüddətli orkestrasiya ssenariləri ayrıca alətlər və Git Bash/WSL tələb edir. ECC native Windows üçün observer daemon və memory-vault yazıları ilə bağlı məhdudiyyətlər də qeyd edir. [ECC platform dəstəyi](https://github.com/affaan-m/ECC/blob/8321021c54d670126ce3b2969d5deb880b4b0c2a/README.md#platform-support)

Layihənin testləri `node:test` və `tsx` üzərindədir. `npm test -- --coverage` hazırkı runner-ə uyğun deyil. Mövcud yoxlamalar:

```powershell
npm test
npx tsc --noEmit --incremental false
npm run lint
npm run build
```

Build-dən əvvəl eyni `.next` qovluğunu işlədən development server dayandırılmalıdır. `react-testing` daxilindəki RTL, Vitest, MSW və axe nümunələri həmin paketlərin burada quraşdırıldığı demək deyil. “80% əhatə” hədəfdir, ölçülməmiş nəticə deyil.

## 7. Məlumat və icazə sərhədləri

İşçi Neon bazası test bazası deyil. `db:reset`, `prisma migrate reset`, seed və avtomatik migration real baza üzərində işlədilməməlidir. Unit runner-in təhlükəsiz, bağlı test ünvanı qorunmalıdır; integration yalnız ayrıca təsdiqlənmiş `TEST_DATABASE_URL` ilə aparılır. Yeni hesab, ailə və əlaqə yaradan brauzer yoxlamaları süni fixture və ya ayrıca test mühitində edilməlidir.

Mövcud CUA, GitHub və Codex Security imkanlarına üstünlük verilir. ECC quraşdırılması yeni servisə giriş, məlumat göndərilməsi, ödəniş, deploy və ya push icazəsi vermir. ECC `security-scan` əsasən Claude konfiqurasiyası üçün AgentShield iş axınıdır; FamilyTree mənbə auditini əvəz etmir.

SessionStart hook sadəcə mətn oxumur: sessiya məlumatını yaza və köhnə qeydləri təmizləyə bilər. Buna görə etibar qərarı istifadəçiyə saxlanılıb. Lazım olarsa `/hooks` vasitəsilə məzmunu və təsirini nəzərdən keçirib ayrıca seçim edin; xəbərdarlığı aradan qaldırmaq üçün kor-koranə aktivləşdirməyin.

ECC-nin `.codex/config.toml` nümunəsi bütöv köçürülməyib: orada başqa model seçimləri, macOS bildirişləri və əlavə MCP serverləri var. Sizin modeliniz, bildirişləriniz və mövcud plaqinlər qorunub. Şəxsi `C:\Users\Zaladdin\.codex\AGENTS.md` gələcək proqramlaşdırma işlərində uyğun ECC bacarıqlarından istifadəni yönləndirir; layihə `AGENTS.md`-si bunu FamilyTree qaydaları ilə tamamlayır. Layihə `.codex/config.toml`-də multi-agent rejimi və eyni sessiyada maksimum dörd paralel agent təyin edilib. İcmal/axtarış rolları yalnız oxuma rejimindədir; spec-miner öz sənədini iş qovluğunda yaza bilir.

İnteqrasiya baxımından kataloq, quraşdırıcılar, native manifest, konfiqurasiya, hook/MCP və layihəyə aid əsas iş axınları araşdırılıb. Bu, bütün upstream kodunun və 292 bacarığın hər təlimatının ayrıca təhlükəsizlik auditi demək deyil.

Yerli bütövlük yoxlamasını istənilən vaxt layihə qovluğundan işə sala bilərsiniz:

```powershell
node scripts/ecc/verify-installation.mjs
```

Bu yoxlama commit, keşdəki skill fayllarının mənbə ilə eyniliyini, adapterləri və söndürülmüş əlavələri yoxlayır; model çağırmır, şəbəkə və bazaya müraciət etmir. Quraşdırma qeydi və adapterlərin dəqiq siyahısı `docs/ecc-installation.json` faylındadır. Tam native aşkarlama üçün ayrıca Codex diaqnostikası lazımdır.

## 8. Yeniləmə və geri qaytarma

Bu quraşdırma yerli, sabit commit-ə bağlıdır. Adi `git pull` ilə nəzərdən keçirilməmiş məzmun gətirməyin. Əvvəl yeni release/commit fərqini, hook və MCP dəyişikliklərini yoxlayın; sonra mənbəni təsdiqlənmiş commit-ə keçirin. Ardınca native plaqini `codex plugin add ecc@ecc` ilə yeniləyin və agent adapterlərinin yeni mənbəyə uyğun yenidən yaradılmasını ayrıca tapşırın. Eyni versiya nömrəsində təkrar quraşdırmanın keşi yenilədiyini fərz etməyin: nəticədəki versiyanı və fayl heşlərini yoxlayın. Quraşdırma qeydi, yollar və yoxlama skriptindəki gözlənilən saylar yeni təsdiqlənmiş versiyaya uyğun yenilənməlidir. Hazır avtomatik adapter-generator skriptinin mövcudluğunu fərz etməyin. Sonra yeni sessiyada təkrar yoxlayın.

Silinmə istənilərsə, yalnız ECC hədəfləri ilə işləyin:

```powershell
codex plugin remove ecc@ecc
codex plugin marketplace remove ecc
```

Ayrıca yaradılmış `ecc-*.toml` adapterləri plaqindən müstəqildir: silməzdən əvvəl `docs/ecc-installation.json` siyahısı və mənşə yoxlanmalıdır. Şəxsi `C:\Users\Zaladdin\.codex\AGENTS.md`, layihənin `AGENTS.md` və `.codex/config.toml` fayllarındakı ECC hissələri də ayrıca geri qaytarılmalıdır; əks halda mənbədən istifadə təlimatı qala bilər. Bütün `config.toml` faylını köhnə ehtiyatla kor-koranə əvəz etməyin; sonradan əlavə edilmiş başqa plaqin və istifadəçi parametrləri itə bilər. Ehtiyatı müqayisə mənbəyi kimi istifadə edib yalnız ECC-yə aid dəyişiklikləri geri qaytarın. Mənbə klonu və keş yalnız dəqiq hədəfləri yoxladıqdan sonra ayrıca silinməlidir.
