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
