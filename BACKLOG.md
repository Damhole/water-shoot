# Water Shoot — backlog

## 🎯 Aktuální okruh

| Stav | Položka |
|---|---|
| 🔨 wip | m01: prototyp v01 — 2D particle vodní dělo, kachničky, perf HUD |

## 💡 Hra

| Stav | Položka |
|---|---|
| 💡 idea | 3D verze (Three.js) — srovnání výkonu proti 2D baseline |
| 💡 idea | Pop-up terče s časovým limitem a bonusovým skóre |
| 💡 idea | Combo systém — série zásahů bez minutí |
| 💡 idea | Plnicí terče (fill objects) — terč se plní vodou, než spadne |
| 💡 idea | Splash by color — barevné týmy kachniček |
| 💡 idea | Zvuky (stříkání, splash, quack, pouťová hudba) |
| 💡 idea | Upgrady děla/pistole za mince — zkracují náběh trysky (`tune.jetRampT`), zvyšují tlak či zužují proud |
| 💡 idea | Persistence mincí přes `gamee` saveState (teď žijí jen v rámci session) |
| 💡 idea | Obchod / odemykání obsahu za mince |

## 🧰 Infra

| Stav | Položka |
|---|---|
| 💡 idea | Prod zip build script |

## 📥 Inbox

_(neotříděné nápady sem)_

## ✅ Hotovo

| Verze | Popis | Commit | Datum |
|---|---|---|---|
| v01 | Prototyp — 2D particle vodní dělo (boční pohled), kachničky 3 dráhy, pop-up terče, perf HUD | c1a7bc1 | 2026-07-30 |
| v02 | First-person perspektiva (fake 3D projekce x/y/z), zásoba vody jako druhý limit kola | 6067477 | 2026-07-30 |
| v03 | Kreslený vodní proud (stuha + dvoubarevné kapky + rozstřikové kroužky), pěna ústí, stress mód `?stress=1&max=&rate=` | 3a3c36a | 2026-07-30 |
| v04 | Auto-spray toggle v HUD (po refreshi vypnuto), rozpojení stuhy mezi stříkáními — starý proud dolétá samostatně | 72b456a | 2026-07-30 |
| v05 | Zavřený konec hlavně (z pohledu hráče do ní nejde vidět), pěna u výstupu proudu | 9c9472b | 2026-07-30 |
| v06 | Klesající hodnota kachniček (kruhový badge + HP bar), kolotočové rozestupy bez překryvů, kratší okno pop-up terčů | e411a8b | 2026-07-30 |
| v07 | Kachničky nemizí — převrhnou se a vztyčí ve slotu; spotřeba vody podle hodnoty dráhy (12/8/5 zásahů) | 749063e | 2026-07-30 |
| v08 | Fix převrhnutí: pivot u dna, vždy na záda (zrcadlení řeší směr), sin-zdvih proti levitaci/visení | 1c81e94 | 2026-07-30 |
| v09 | HUD na plátně: velké skóre uprostřed modré pasáže, čas vpravo, nádržka vody u děla s blikáním | f2bd378 | 2026-07-30 |
| v10 | Zásah = potopení pod hladinu (clip, bez rotací); speciální korunková kachnička 300 b / 18 zásahů / ~6 s | 9497663 | 2026-07-30 |
| v11 | Damage cooldown 80 ms (≈12 HP/s) — kachničky vydrží viditelné kropení; HP 14/10/6, královská 36 | 20e9eda | 2026-07-30 |
| v12 | Truhlička s odměnou: 6 zásahů → otevře se a vyjede +8 s (hodiny) / +25 vody (kapka); okno 5 s | b329ce8 | 2026-07-30 |
| v13 | HP podle hodnoty (12/8/5, klesá s decay), královská dojíždí řádek (nemizí sama), truhla pluje v dráze, damage jen koncem proudu | d2c2c0c | 2026-07-30 |
| v14 | Rotace hodnotových tierů mezi drahami (á 15 s, náhodný start), squash&stretch + „KVÁK!" při sestřelu, výraznější houpání truhly | 1b73af1 | 2026-07-30 |
| v15 | Krit zásah do kolečka s body (1.0 vs 0.5 dmg + větší splash a kroužek), safe-zone spawn truhly — vyplouvá na vstupní straně s celým průjezdem | 6ab45d0 | 2026-07-30 |
| v16 | Combo multiplikátor ×2–×5 (okno 4 s): zlatý odtékající bar pod skóre + wiglující ×N, floatery ukazují násobený zisk | 2a36dd7 | 2026-07-30 |
| v17 | Snížena životnost královské kachničky 36 → 22 | 4a5f879 | 2026-07-30 |
| v18 | Odstraněn combo multiplikátor (revert v16) — skóre zpět na prosté hodnoty | 9832ef6 | 2026-07-30 |
| v19 | GitHub Pages entry + mobilní PWA metas; relativní míření pro dotyk (trackpad s akcelerací), výraznější zaměřovač, citlivost v HUD | c959843, 209e39e | 2026-07-30 |
| v20 | Ukazatel vodní nádrže přesunut na levou stranu obrazu | cba2320 | 2026-07-30 |
| v21 | **Fix:** overlay konce kola se nikdy nezobrazil (crash na chybějícím `overlay-title`); nový vzhled — důvod konce, velké skóre, čas, tlačítko Hrát znovu | 14f7e82 | 2026-07-30 |
| v22 | Divadelní opona: rozhrnutí na startu kola, zatažení při konci (čas/voda); overlay čeká na zatažení, během rozhrnování stojí čas i stříkání | cccb4d1 | 2026-07-30 |
| v23 | Držení linie na středu = exponenciální nárůst poškození (×1,25 za zásah, strop ×4, grace 0,3 s); prstenec se rozžhaví do zlaté | 1f533ca | 2026-07-30 |
| v24 | Pulzující kruhy vycházející ze středu kachničky při držené linii — rychlost i jas rostou se sérií | 01187ba | 2026-07-30 |
| v25 | Dojití vody: proud ztrácí tlak, zakuckává se, padá k dělu a dokape (1,4 s), teprve pak konec kola; kapka z truhly ho stihne zachránit | 446c63f | 2026-07-30 |
| v26 | Pomalejší dokapávání — ztráta tlaku 2,8 s, konec kola až po doznění kapek ve 3,9 s | 9a11846 | 2026-07-30 |
| v27 | Skill-based zásahy: užší proud (rozptyl 55→26), střed 1,2× focus (růst 1,32, strop ×5) vs okraj 0,4; střed i u truhly, bullseye u terčů (+150). Naměřeno 3× rychlejší sestřel při přesném míření | 66736d7 | 2026-07-30 |
| v28 | Náběh trysky po každém stisku (0,45 s do plného tlaku a dostřelu), slider v HUD — připraveno jako hook pro budoucí upgrady děla | f033233 | 2026-07-30 |
| v29 | Special mód (přepínatelný): 3 sejmuté královské kachny → duhový režim na 10 s — dvě rotující trysky, duhová voda, 2× poškození, nespotřebovává vodu ani čas; tracker korunek v UI, po doběhnutí se resetuje | 995aecc | 2026-07-30 |
| v30 | Náběh trysky konečně vidět: slabší start (dolet ~¼) + náběh 0,7 s (delší než doba letu vody), proud se zvedá zdola k zaměřovači | bbc0319 | 2026-07-30 |
| v31 | Peří při sestřelu (vlastní pool, třepotavý pád); duhové dělo: 3× poškození, tiky 45 ms, okamžitý tlak + **fix** konvergence dvou trysek (stříkaly vedle středu) — život ubývá 6× rychleji | 6f4238b | 2026-07-30 |
| v32 | Výdrž = hodnota/12 (20 → 2 zásahy, 150 → 13); duhový režim ztrojnásobí počet kachniček na scéně (8 → 24, rovnoměrné rozestupy), po doběhnutí se potopí | 35aa27a | 2026-07-30 |
| v33 | FPS counter v levém horním rohu — zelená ≥55, žlutá ≥30, červená níž; kreslí se nad vším včetně opony | 6eb0a9d | 2026-07-30 |
| v34 | Truhly přepsány na pole; v duhovém režimu až 3 naráz (každá v jiné dráze, spawn co 0,8–2,2 s) → víc času a vody k nasbírání, normálně zůstává jedna | e97b443 | 2026-07-30 |
| v35 | Mince: počítadlo v HUD vlevo nahoře, mincové kachničky (14 %, +3), královská +10, truhla má třetí odměnu (+15). Přežívají restart kola | aeae5a1 | 2026-07-30 |
| v36 | Mince letí obloukem do HUD ikony (připsání až při dopadu, cuknutí ikony); ukazatel mince nad kachničkami skryt — hráč neví předem, která platí; truhla se kreslí za kachničkami + spawn doprostřed mezery (0 kolizí ze 40) | f089517 | 2026-07-30 |
| v37 | Nová grafika děla podle předlohy: válcové stínování, dvě zlaté obruče, zubatý vzor pod ústím, rozšířené nálevkovité ústí; kresba přepsána do lokální soustavy hlavně | 562e3b9 | 2026-07-30 |
| v38 | Perspektiva děla: z nadhledu zmizel otvor hlavně (silně zkrácený prstenec místo elipsy s dírou), obruče prohnuté podle válce | 9d2d416 | 2026-07-30 |
| v39 | Fáborková girlanda nad terči — 15 fáborků, každý kyvadlo s pružinou a tlumením; proud vody je rozhoupe (až ~70°) a samy se vrátí do klidu | 45c6dec | 2026-07-30 |
| v40 | Hra přejmenována na **Golden Ducks** (cedule, titulek, badge, PWA název); nápis se auto-zmenší podle šířky displeje | ef4c515 | 2026-07-30 |
| v41 | Odstraněna fáborková girlanda (revert v39) — vizuálně nesedla | 6010ec0 | 2026-07-30 |
| v42 | Rychlejší doplnění řady (prázdno 1,3 s místo 2,3–3,8 s) + sestřel zkracuje čekání na královskou o 1,8 s (min 0,8 s). Simulace: 3,6 královských/kolo v nečinnosti vs 6,0 při 1 sestřelu/s | 66d3e1c | 2026-07-30 |
| v43 | Odměna za aktivitu zvýšena — sestřel ukrojí 3 s (min 0,6 s); simulace: 3,7 královských v nečinnosti vs 7,0 při 1 sestřelu/s (téměř 2×) | d1bb4ee | 2026-07-30 |
| v44 | **Fix:** královská vznikala odvozeně od sousední kachničky, často až u výjezdu → hráč ji nestihl. Teď vjíždí z náhodného místa vstupní části dráhy, vždy 4,7–11,2 s na obrazovce (medián 7,5) | 300c892 | 2026-07-30 |
| v45 | Truhla se po otevření potopí pod hladinu (víko zůstává otevřené) místo aby zmizela; stejně mizí i nestihnutá truhla | 3700a49 | 2026-07-30 |
| v46 | **Fix zaseknutí v duze:** sestřel královské během duhového režimu resetoval `rainbowT` na 10 s a znovu volal `addRainbowDucks()` → nekonečná duha + hromadění kachniček. Nyní královské v duze nepřijíždějí a korunky se nesbírají | a4c4fc2 | 2026-07-30 |
| v47 | **Fix překryvů:** královská hledá volné místo — 24 kandidátů ve vstupní části dráhy s kontrolou odstupu (76 % překryvů → 0 %, min odstup 1,05× kachnička). Opraveno i míchání drah (Fisher-Yates místo `sort()` s náhodným komparátorem) | e175227 | 2026-07-30 |
| v49 | Puzzle mód: bazénové prostředí, skleněný válec na čepu s uvězněnou kachničkou, napouštění otvorem; **fix** balistiky — mířila vždy na zadní stěnu, proto se muselo mířit výš | 5513ab5 | 2026-08-03 |
| v50 | Skutečná kapalina (2D Position Based Fluids): mřížka sousedů, tlakový řešič, viskozita, povrchové napětí, metaball render. Kachnička plave na reálné hladině, slider počtu částic v HUD | e17e5db | 2026-08-03 |
