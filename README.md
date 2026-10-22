# Baník VIP – dotykový kiosek

Webový prototyp pro sdílenou obrazovku ve VIP zóně FC Baník Ostrava. Vychází z kiosku HC Vítkovice, upravený pro fotbal a v barvách Baníku. Repozitář: https://github.com/RamirroEndetry/FC-Banik

## Návštěvník

1. Úvodní spořič s intro videem a výzvou „Dotkni se obrazovky“.
2. Jedna karta konkrétního zápasu s týmy, termínem a odpočtem do otevření tipování. Návštěvník utkání nevybírá; zadá jméno, výsledek 1/X/2 a přesné konečné skóre.
3. Po potvrzení poděkování; za 12 sekund čistý úvod pro dalšího návštěvníka. Po 90 sekundách nečinnosti se rozpracovaný formulář vymaže.
4. Vstup „Průběžné pořadí a vítězové“ zobrazí tabulku všech tipů v aktuálním zápase: jméno, tipované skóre, odchylku a sdílené pořadí. Při dostupném aktuálním skóre zvýrazní průběžné lídry, po potvrzení výsledku konečné vítěze a vyzvednutí ceny ve VIP zóně.

Tipuje se **konečné skóre po 90 minutách včetně nastaveného času**; ligový zápas nemá prodloužení ani penalty a remíza je platný tip. Tipování se automaticky OTEVŘE 30 minut před výkopem a automaticky se ZAMKNE 10 minut po něm; potom kiosek žádný tip nepřijme (férovost — nikdo netipuje s výhodou rozehraného zápasu). Obsluha nic nepotvrzuje.

## Rozdíly proti hokejové verzi

- Konečné skóre místo stavu po 60 minutách; tip na prodloužení / nájezdy odpadl. Formulář má tři kroky (jméno, 1/X/2, skóre).
- Pořadí: 1) nejmenší součet odchylek obou skóre, 2) dřívější čas tipu (`Competition.rank` v `dist/competition.js`). Skóre 0–20.
- Fáze zápasu: před zápasem, 1. poločas, poločasová přestávka, 2. poločas, konec zápasu; minuta včetně nastavení (např. 90+3').
- Živé skóre z onlajny.com (zdroj, na který odkazuje fcb.cz) přes Cloudflare Worker – viz níže.
- Pozice hráčů: brankáři, obránci, záložníci, útočníci. Profil ukazuje narození, výšku/váhu, národnost a statistiky v jednotlivých soutěžích sezóny.
- Barvy: královská modř #0e3a7e, baníkovská světle modrá #2499dd, zlatá a červená ze znaku.

## Ceny a přehled soutěžících

Úvodní obrazovka má pod kartou zápasu dva panely (na širokém displeji po stranách): vlevo „Co můžeš vyhrát – Ceny pro tento zápas“, vpravo „Kdo už tipuje“ s posledními čtyřmi tipy a počtem všech. Bez tipů ukazuje výzvu „Zatím nikdo nehrál. Buď první a tipuj!“. Ceny jsou uložené pro každý zápas zvlášť (`state.prizes[matchId]`), obsluha je upravuje v administraci v bloku „Ceny pro tento zápas“ (až šest položek, název + poznámka); dokud je neuloží, platí výchozí trojice (podepsaný dres, dvě vstupenky do VIP zóny, balíček z fanshopu).

## Obsluha a vyhodnocení

Klikněte na malé ozubené kolečko vpravo dole a zadejte dohodnuté administrátorské heslo (stejné jako u kiosku Vítkovic). Také `/#obsluha` vyžaduje heslo. Zvolte aktivní utkání pro celou VIP zónu. Volba se ukládá na tomto zařízení. Jakmile má zápas oficiální výsledek, kiosek v **6:00 ráno po dni zápasu** (nejdřív však 5 minut po vyhlášení vítěze) sám přepne na nejbližší další zápas bez výsledku (`autoAdvanceMatch` v `dist/app.js`). Když obsluha po tomto okamžiku ručně vybere odehraný zápas, kiosek ho nechá. Při úplně prvním spuštění se předvybere nejbližší budoucí zápas.

Tipy se zamknou samy 10 minut po výkopu. Konečný výsledek se po konci zápasu zapíše sám z onlajny.com, pokud kiosek běží přes Worker. Jinak (nebo při výpadku zdroje) jej obsluha zadá ručně; před uzavřením tipování to nejde. Potvrzený výsledek je v UI uzamčený.

V administraci dále: **Ruční otevření tipování** (ostrá zkouška před oknem, zamčení 10 minut po výkopu platí vždy), **Tipy tohoto zápasu** se smazáním jednotlivých i všech tipů, **Spustit zkušební tipování** (tipy se neukládají) a **Spustit demo zápasu** (tři ukázkové tipy, každých 5 s další událost: výkop, góly, poločas, nastavení, konec 2:1 a vyhlášení s pohárem; nic se neukládá).

## Záloha tipů a výsledků

Tipy, výsledky, ceny a vybraný zápas se ukládají jen do localStorage prohlížeče (klíč `banik-vip-kiosk-v1`). Administrace má blok **Záloha tipů a výsledků**:

- **Stáhnout zálohu** uloží celý stav do `banik-vip-zaloha-RRRR-MM-DD-HHMM.json`. Doporučení: po každém zápase zálohu uložit mimo kiosek.
- **Tabulka tipů pro Excel (CSV)**: zápas, datum, pořadí, jméno, tip, odchylka, čas tipu, konečný výsledek (UTF-8 s BOM, středník). Jména začínající = + - @ dostanou apostrof.
- **Obnovit ze zálohy…** jen **doplní** chybějící tipy a výsledky, nic nepřepíše.

## Dotyková klávesnice

Přihlášení do administrace má vlastní dotykovou klávesnici. V administraci přepínač **⌨ Klávesnice** ukotví klávesnici s českými znaky, která píše do naposledy aktivního pole (ceny, výsledek, jméno návštěvníka).

## Živé skóre z onlajny.com

Fcb.cz odkazuje na živé přenosy onlajny.com. Stránka zápasu (např. https://www.onlajny.com/match/index/id/533874) obsahuje aktuální stav, minutu a skóre přímo v HTML, ale **neposílá CORS hlavičky**, takže ji prohlížeč kiosku sám načíst nemůže. Proto:

- `worker.mjs` (Cloudflare Worker) obsluhuje `GET /api/live?matchId=plz&onlajny=533874`: stáhne stránku, převede ji funkcí `LiveMatch.fromOnlajny` (`dist/live.js`) na snapshot `{matchId, home, away, phase, clock, updatedAt, final}` a vrátí JSON. Ověřeno proti skutečným stránkám (odehraný Baník–Sparta 0:0 → `fulltime`, nadcházející Plzeň → `scheduled`).
- Kiosek se po výkopu každých 15 s ptá na `api/live` (relativně, tedy u Workeru, který kiosek servíruje). Když kiosek běží jinde (např. GitHub Pages) a Worker je nasazený zvlášť, stačí do `<body>` v `dist/index.html` doplnit `data-live-endpoint="https://<worker>.workers.dev/api/live"`.
- Bez Workeru (čisté GitHub Pages) kiosek oznámí „Živé skóre tu není k dispozici. Výsledek po zápase zapíše obsluha.“ a ptá se jen jednou za minutu. Vše ostatní funguje.
- Stav „konec“ výsledek **zapíše automaticky** (`results[matchId].source = "onlajny.com"`) a spustí vyhlášení s pohárem. Odložený nebo zrušený zápas se ohlásí jako chyba, výsledek se nezapíše. Výpadek zdroje zruší průběžné pořadí, které se obnoví při dalším úspěšném dotazu.
- Každý zápas v `dist/data.js` nese `onlajny` = id přenosu (z rozpisu na fcb.cz). Přesné názvy stavů během živého zápasu (např. „1. poločas“, „poločas“) se ověří při nejbližším utkání; adaptér je tolerantní a bez názvu stavu rozhoduje podle minuty.

## Rozpis zápasů

`dist/data.js` obsahuje domácí zápasy Chance Ligy 2026/27 z https://www.fcb.cz/zapasy.asp?sezona=2027&kategorie=MUZ&druh=liga&kde=doma (ověřeno 21. 10. 2026): Sparta (18. 10., odehráno 0:0 – pro zkoušky), Plzeň (1. 11. 15:00), Teplice (21. 11. 15:00), Hradec Králové (6. 12. 18:00). Jarní zápasy zatím nemají čas výkopu; doplní se stejným způsobem (id soupeře, datum s časovou zónou, kolo, id onlajny z odkazu na fcb.cz).

## Spuštění a kontroly

- `python -m http.server 5173 --directory dist`
- `npm run check` – testy vyhodnocování, toku kiosku, adaptéru onlajny.com a Workeru s pevným časem.
- `npm run dev` – místní Cloudflare náhled přes Wrangler (včetně `/api/live`).

## GitHub Pages

Workflow `.github/workflows/pages.yml` při každém pushi do `main` publikuje složku `dist` (s verzí commitu místo `__V__` kvůli cache) na https://ramirroendetry.github.io/FC-Banik/. Na Pages funguje vše kromě živého skóre (viz výše).

## Cloudflare

`wrangler.jsonc` připravuje Worker `fc-banik` s obsluhou `/api/live` a statickými soubory. V Cloudflare připojte GitHub repozitář přes Workers Builds (sestavení `npm run build`, nasazení `npx wrangler deploy`), nebo po `npx wrangler login` spusťte `npm run deploy`.

## Panel na výšku a spořič s intro videem

Na displeji na výšku (od 900 × 1400 px, typicky 1080 × 1920) se zapne samostatné rozvržení. Když úvodní obrazovku 45 sekund nikdo nepoužije, přehrává se 24s intro (`dist/assets/intro/intro-portrait.mp4` na výšku, `intro.mp4` na šířku): reflektory nad stylizovaným hřištěm a letící míč, představení Václava Jurečky, Martina Jedličky, Filipa Kubaly a Michala Frydrycha, sestava pěti hráčů s nápisem „Modrobílé srdce Ostravy“ a nakonec znak s textem „Na trávníku tým. Ve hře ty.“. Při špatně hlášené orientaci panelu otevřete kiosek jednou s `?video=vyska` nebo `?video=sirka` (`?video=auto` volbu zruší).

Videa skládá `npm run intro:render` (na šířku) a `npm run intro:render -- --portrait` (Python, Pillow, numpy, ffmpeg). Fotky hráčů bere v plném rozlišení z fcb.cz (cache `scripts/.intro-cache`, není v gitu). Hráče a texty lze změnit v hlavičce `scripts/render-intro.py`.

## Klubový obsah

`npm run content:sync` (`scripts/sync-club-content.py`, Python 3 + Pillow) stáhne z oficiálního webu https://www.fcb.cz:

- soupisku A-týmu a profily hráčů (fotky zmenšené na 900 px výšky do `dist/assets/players`),
- partnery podle kategorií (loga ořezaná a převedená na PNG do `dist/assets/partners`; generální partner je pevně vlevo, ostatní rotují po čtveřicích každých 8 s),
- znak klubu (`dist/assets/club-logo.png`),
- fotky k časové ose historie (`dist/assets/history`).

Aktuální snapshot (21. 10. 2026): 26 hráčů, 99 partnerů, 26 milníků historie. Fotografie Maksyma Diachuka je na webu klubu poškozená, jeho profil proto ukazuje znak.

Historie na fcb.cz je jeden dlouhý text; časová osa v kiosku je z něj stručně sepsaná (seznam `MILESTONES` ve skriptu, roky a fakta podle oficiální historie a přehledu úspěchů). Obrazovka „Úspěchy klubu“ ukazuje 4 tituly (1975/76, 1979/80, 1980/81, 2003/04), 6 stříbrných sezón a 4 národní poháry.

Loga soupeřů: `npm run logos:sync` stáhne znaky všech 16 klubů Chance Ligy z `fcb.cz/znaky` do `dist/assets/teams` a zapíše `sources.json` s kontrolními součty.

## Vyhlášení s pohárem

Po potvrzení konečného výsledku aplikace spočítá vítěze a automaticky zobrazí pohár, gratulaci, jméno nebo jména, tip, odchylku a pokyn k vyzvednutí ceny ve VIP zóně. Při shodě zůstávají všichni společnými vítězi. Vyhlášení má vlastní časovač 5 minut, zavře se dotykem nebo klávesou Escape; na výsledkové obrazovce lze pohár znovu otevřít tlačítkem **Zobrazit pohár**.

## Omezení prototypu

Data jsou pouze v localStorage tohoto prohlížeče. Administrace má pouze místní heslovou bránu v JavaScriptu (heslo lze zjistit ze zdrojového kódu). Jména nejsou ověřená. Živé skóre se čte z veřejné stránky onlajny.com bez smlouvy; při změně jejího formátu je potřeba upravit adaptér. Rozpis je statický. Nejde o nasazenou produkční soutěž.
