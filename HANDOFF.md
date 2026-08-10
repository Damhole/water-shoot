# Golden Ducks — předávka a jak spolu pracujeme

Praktická příručka pro pokračování. Pro širší kontext viz [CLAUDE.md](CLAUDE.md)
a [BACKLOG.md](BACKLOG.md).

---

## KDE ZAČÍT PO NAČTENÍ

**Otevři <https://damhole.github.io/water-shoot/>** — kořen Pages přesměruje
rovnou na 3D prototyp, na kterém se pracuje. Stará 2D verze je odtud odkazem.

Lokálně:

```bash
python3 server.py     # z rootu repa, port 8090
```

```
http://localhost:8090/.claude/worktrees/m04-simple-01/gamee/_jet3d.html
```

Na telefonu tatáž cesta, jen IP Macu místo `localhost`
(`ipconfig getifaddr en0`). `localhost` na telefonu znamená telefon sám.

---

## VĚTVE

| větev | co v ní je |
|---|---|
| `master` | jen init commit, **nikdy do něj nepsat** |
| `m01-vodni-proto-01` | remote větev, ze které běží Pages |
| `m02-puzzle-01`, `m03-veze-01` | starší milníky |
| **`m04-simple-01`** | **vývojová větev, verze v139** — sem patří práce |
| **`pages-jet3d`** | nasazovací větev pro Pages |

**Jak to spolu souvisí:** pracuje se ve worktree `m04-simple-01` a soubor
`gamee/_jet3d.html` se po každém kroku kopíruje do worktree `_pages-jet`
(větev `pages-jet3d`) jako `_jet3d.html` **i** `jet3d.html`. Odtud se pushuje
na Pages. Kdyby se obojí někdy rozešlo, rozhoduje `m04-simple-01`.

Práce z 10. 8. 2026 je v `m04-simple-01` pod commitem **v138** a v `pages-jet3d`
rozdělená do menších commitů podle témat.

### Nasazení na Pages

Push spouští **vždy uživatel** — prostředí ho asistentovi blokuje. Asistent
tedy commituje do `pages-jet3d` a předá příkaz; hotové commity se hromadí,
dokud je uživatel nepushne.

```bash
cd /Users/denishrazdira/CodeProjects/water-shoot && git push origin pages-jet3d:m01-vodni-proto-01
```

Před pushem se hodí ověřit, že je to fast-forward:

```bash
cd .claude/worktrees/_pages-jet && git merge-base --is-ancestor origin/m01-vodni-proto-01 HEAD && echo OK
```

Po minutě:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://damhole.github.io/water-shoot/gamee/jet3d.html
```

**Past s podtržítkem:** Pages ženou všechno přes Jekyll a ten ignoruje soubory
začínající podtržítkem. Proto je v repu `_jet3d.html` (pracovní) i jeho kopie
`jet3d.html` (pro Pages) a při každé změně se musí zkopírovat obojí.

---

## JAK SPOLU PRACUJEME

Tohle je to podstatné, co se za den vyladilo:

- **Komunikace česky**, nikdy slovensky.
- **Jedna věc naráz a nechat ji potvrdit.** Když se v jednom kroku změní tři
  věci, dvě z nich něco pokazí a nepozná se která.
- **Měřit číslem, neodhadovat.** „Vypadá to líp" nestačí — kolik jednotek,
  kolik procent, kolik FPS. Několikrát tím vyplavaly skutečné chyby, které by
  jinak prošly (schovaný terčík, prosvítající police, blur skákající na
  maximum, levitující kachničky).
- **Hlásit i to, co se nepovedlo.** Když měření vyjde jinak, než jsem tvrdil,
  řekne se to rovnou i s číslem.
- **Ladicí kód po sobě uklidit.** Do souboru se při hledání dává
  `window.__t = {...}`; po doměření musí zmizet a ověřit se to grepem.
- **Ovládání do ⚙ panelu místo hádání.** Co je věc vkusu (zorný úhel, sytost,
  barva vody, síla stínu), patří na posuvník, aby si to uživatel doladil
  na telefonu v ruce.
- **Commit průběžně, push/PR/merge jen na výslovný pokyn.**

### Pasti v měření, na které jsem naletěl

- **Panel prohlížeče usíná** a má zaškrcený `requestAnimationFrame`. FPS
  načtené přes JS pak ukazuje 5–7 a vypadá to jako katastrofa. **Jediné
  poctivé číslo je badge odečtený ze snímku obrazovky**, kdy je panel vidět.
- **Skutečný kurzor panelu přebíjí synteticky poslané `pointermove`.** Měření
  míření se musí odečítat ještě za držení, ne po něm.
- Zpětné apostrofy v `git commit -m` si vyhodnotí shell. Používat `-F -`
  a heredoc.

---

## CO HRA UMÍ (3D prototyp)

Soubor: `gamee/_jet3d.html` (+ kopie `jet3d.html`). Vanilla JS, Three.js
r170, cannon-es, **žádný build step**.

- **Nekonečný bar po patrech.** Tři sekce, které se recyklují; po vyčištění
  patra bar sjede o 620 dolů, nahoře se odkryje další část s novým
  rozestavěním. **Jede bar, ne kamera** — ústí trysky, balistika i míření
  tak zůstávají ve svých souřadnicích.
- **Kachničky-bandité** z `img/bandit_ducks.png` jako automatické terče:
  červenobílý terčík na těle, modrý prstenec plnění, squash s pivotem u paty,
  peří a „+N" po sestřelu. Patro má pevný počet a **zbývající počet je zároveň
  stropem toho, co smí být na scéně**.
- **Voda**: jedna trubice podél balistické dráhy, uzly letí každý svou drahou.
  Zastaví se o dřevo, kachničky i lahve. Ostré bílé i vodou zbarvené kapky.
- **Míření**: promítá prst do roviny terčů. Na dotyku relativní s akcelerací
  (1,97× pomalu, 4,5× švih) a zaměřovač nad prstem.
- **Lahve** jsou skutečná tělesa (cannon-es), dají se převrhnout a shodit.
- **Stíny**, paralaxa kamery, směrové rozmazání při přejezdu, dobrzdění kamery.

### ⚙ panel

Zorný úhel, sytost barev, barva/průhlednost/svítivost vody, tloušťka a barva
obrysu vody, **automatické stříkání** (proud míří sám a přejíždí nahoru dolů,
myš se ignoruje — na ladění), parametry trysky, stíny a poloha světla.
Vše se ukládá do `localStorage` pod `ws_jet3d_tune`.

---

## PRAVIDLA, KTERÁ STÁLA NEJVÍC ČASU

Nedodržet je znamená zopakovat celý den:

- **V herní smyčce nealokovat.** Geometrie ani vektory. `new TubeGeometry()`
  každý snímek znamenalo 5,3 MB/s a Android Chrome to poznal.
- **Statickému tělesu si cannon spočítá AABB jednou.** Při posunu police se
  musí nastavit `aabbNeedsUpdate`, jinak jí lahve propadnou.
- **`touch-action` na `body` zabije rolování i uvnitř panelu** — skládá se
  z prvku i všech předků. Zákaz gest patří jen na plátno.
- **`100vh` je na mobilu výška bez lišt.** Na panel, který má být celý vidět,
  patří `100svh` a `box-sizing: border-box`.
- **Three barvy spravuje** (r170, ColorManagement, výstup sRGB). Nevypínat —
  rozhodí textury. Sytost se řeší v HSL, a to v sRGB, ne v lineárním prostoru.
- **Toon materiál na velkou plochu, která chytá stín, je drahý.** Podlaha
  3000×3000 s `MeshToonMaterial` srazila 60 FPS na 45. Zůstává Lambert.
- **Kachnička nevyplňuje buňku spritu celou a každá varianta jinak** (16 /
  11,5 / 24,2 / 24,4 % prázdna dole) — výška posazení je proto per varianta.
- **Míří se do roviny terčů**, ne do proměnné hloubky; jinak zaměřovač sedí
  na kachničce jen opticky.

---

## CO JE ROZDĚLANÉ

1. **Výkon na telefonu není změřený.** Na Macu drží 60 FPS, ale to je hlavní
   otevřená otázka. Podezřelí v pořadí: SVG rozmazání při přejezdu, stínová
   mapa 2048, tři sekce baru. Stíny jsou za zaškrtávátkem, blur a mapa ne.
2. **`bandit_ducks.png` má 1,6 MB** na 1024×1024. Na terče velikosti ~120 px
   by stačilo 512² a WebP, tedy někam ke 100–200 kB.
3. **Výchozí hodnoty v ⚙ panelu jsou můj odhad** — zorný úhel 48°, sytost
   135 %, barva vody `#4aa9dd`. Až si je uživatel doladí na telefonu, zapsat
   je jako výchozí do kódu.
4. **Police pod hrací sekcí jsou prázdné**, bez lahví.
5. **Kompozice lahví losuje jen polohu**, ne typy — nehlídá se, aby vedle
   sebe nestály dvě stejně vysoké.
6. Nevysvětlený **světle modrý pruh od otvoru dolů** ve 2D puzzlu.
