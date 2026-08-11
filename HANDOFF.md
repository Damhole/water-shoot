# Golden Ducks — předávka a jak spolu pracujeme

Praktická příručka pro pokračování. Pro širší kontext viz [CLAUDE.md](CLAUDE.md)
a [BACKLOG.md](BACKLOG.md), kde je každá verze i s tím, PROČ se udělala.

Stav k **v198**.

---

## KDE ZAČÍT PO NAČTENÍ

Hraje se **3D westernová střelnice** v `gamee/_jet3d.html`. Původní 2D verze
(`index_local.html`, tři módy) leží vedle, nesahá se na ni.

```bash
python3 server.py     # z rootu repa, port 8090
```

```
http://localhost:8090/.claude/worktrees/m04-simple-01/gamee/_jet3d.html
```

Na telefonu tatáž cesta, jen IP Macu (`ipconfig getifaddr en0`).
`localhost` na telefonu znamená telefon sám.

---

## VĚTVE

| větev | co v ní je |
|---|---|
| `master` | jen init commit, **nikdy do něj nepsat** |
| `m01-vodni-proto-01` | remote větev, ze které běží Pages |
| `m02-puzzle-01`, `m03-veze-01` | starší milníky |
| **`m04-simple-01`** | **vývojová větev, verze v198** — sem patří práce |
| **`pages-jet3d`** | nasazovací větev pro Pages |

Pracuje se ve worktree `m04-simple-01`, po každém kroku se `gamee/_jet3d.html`
kopíruje do worktree `_pages-jet` jako `_jet3d.html` **i** `jet3d.html`.
Kdyby se obojí rozešlo, rozhoduje `m04-simple-01`.

**Push spouští vždy uživatel** — prostředí ho asistentovi blokuje. Commity se
hromadí, dokud je nepushne:

```bash
cd /Users/denishrazdira/CodeProjects/water-shoot && git push origin pages-jet3d:m01-vodni-proto-01
```

**Past s podtržítkem:** Pages ženou všechno přes Jekyll a ten ignoruje soubory
začínající podtržítkem. Proto je v repu `_jet3d.html` (pracovní) i kopie
`jet3d.html` (pro Pages) a při každé změně se kopíruje obojí.

---

## PRAVIDLA HRY (stav k v198)

**Cíl:** vydržet co nejdéle a nasbírat co nejvíc mincí. Za mince si hráč
nakonec něco koupí (zatím nepostavené).

- **Voda je jediný zdroj konce.** Stříkání ji ubírá **3,3 %/s**, tedy plná
  nádrž vydrží 30 s nepřetržitého proudu. Dojde-li, je konec.
  - Na 25 % přijde varování „Low water!" a pruh začne pulzovat (velikost
    i obrys do tlumené červené).
  - Pod 6 % slábne tlakem proud, pod 4 % se plocha zatmívá, na 2,5 %
    je konec. **Zatmívání je jednosměrné** — jakmile začne, nezachrání
    to ani plná nádrž. Je to bod, ze kterého není návratu.
- **Životy jsou VYPNUTÉ** (`ZIVOTY_ZAP = false`). Kód zůstal celý.
- **Mince** padají z kachniček (40 % jich něco má) a jsou to **tělesa ve
  scéně**, ne ikonky: vyloupnou se u kachničky, chvíli visí a odletí do pruhu.
- **Bandité s koltem** vystřelí **jednou za život**, těsně před odchodem, a to
  jen když je jim vidět na kolt (kontroluje se každý snímek). Střela okrádá:
  vysype **22 % banku, nejmíň 3 a nejvíc 15 mincí**. Ty se rozsypou po
  policích, kutálejí se a padají z obrazu — **kdo je stihne trefit proudem,
  dostane je zpátky** (Sonic).
- **Lahve**: první zásah dá buď +1 bod, nebo vodní kapku (32 % lahví), **nikdy
  obojí**. Rozbitá lahev už se nevrací, nové sklo přijede až s patrem.
- **Složení patra je dané dopředu** balíčkem druhů o velikosti kvóty. Zabitá
  kachnička druh spotřebuje, **odešlá ho vrátí zpět** — patro se nedá přečkat.
  Platí invariant: **balíček + živé = kolik zbývá sestřelit**.

---

## JAK SPOLU PRACUJEME

- **Komunikace česky**, nikdy slovensky.
- **Jedna věc naráz a nechat ji potvrdit.** Když se v jednom kroku změní tři
  věci, dvě z nich něco pokazí a nepozná se která.
- **Měřit číslem, neodhadovat.** „Vypadá to líp" nestačí. Několikrát tím
  vyplavaly skutečné chyby, které by jinak prošly.
- **Hlásit i to, co se nepovedlo**, i to, co jsem si spletl.
- **Ladicí kód po sobě uklidit** (`window.__t = {...}`) a ověřit grepem.
- **Co je věc vkusu, patří na posuvník** v ⚙ panelu, ne do hádání.
- **Commit průběžně, push/PR/merge jen na výslovný pokyn.**
- Po každém commitu `vXX:` bump na `vYY` + řádek do BACKLOG.md.

### Pasti v měření, na které jsem naletěl

- **Panel prohlížeče usíná** a má zaškrcený `requestAnimationFrame`. FPS pak
  ukazuje „–" a scéna stojí. Jediné poctivé číslo je z běžícího panelu.
- **Konzole nezachytí chybu při načtení** modulu (čtečka se připojí až potom).
  Poznávací znamení: FPS badge zůstane na „–" a globální hák se nevytvoří.
- **Zpětné kontroly lžou.** Ověřoval jsem „střílel zpoza lahve?" proti
  aktuálnímu rozestavění — jenže lahve se mezitím pohnuly. Verdikt se musí
  zaznamenat v okamžiku události.
- **Testy na skončené hře nic neukážou.** `krokKachen` a spol. jsou za
  `if(!konec)`, takže se nic nehýbe a vypadá to jako rozbitá mechanika.
- Zpětné apostrofy v `git commit -m` si vyhodnotí shell. Používat `-F -`
  a heredoc.

---

## PRAVIDLA, KTERÁ STÁLA NEJVÍC ČASU

Nedodržet je znamená zopakovat celý den.

- **V herní smyčce nealokovat.** Geometrie ani vektory.
- **DOČASNÁ MRTVÁ ZÓNA.** Konstanta na úrovni modulu, která sáhne na `const`
  deklarovaný o tisíc řádků níž, shodí celou hru ještě před prvním snímkem
  (`KACH_R`, `koloda`, `ZIVOTY_ZAP`). Uvnitř funkce je to v pořádku, protože
  se vyhodnotí až za běhu. **Naletěl jsem na to čtyřikrát.**
- **Srážka jmen konstant.** `MINCE_CEKANI` existovalo dvakrát a modul spadl.
  Nové názvy pro nové věci, i když se to opakuje.
- **Statickému tělesu si cannon spočítá AABB jednou** — při posunu police
  nastavit `aabbNeedsUpdate`.
- **`touch-action` na `body` zabije rolování i uvnitř panelu.**
- **`100vh` je na mobilu výška bez lišt** — na panel patří `100svh`.
- **Three barvy spravuje** (r170, ColorManagement, sRGB). Nevypínat.
- **Toon materiál barvu utlumí** a globální sytost ji ještě projede — co má
  sedět s HUD (mince), musí být `MeshBasicMaterial`.
- **Sprity mají pevnou velikost ve světě.** Nápis u police a nápis u kamery
  jsou pak různě velké — proto se škálují podle hloubky.
- **Odlesk uvnitř koule si koule zakryje.** Musí ležet za poloměrem.
- **Nastavení se ukládá podle id.** Když se změní výchozí hodnota posuvníku,
  musí se změnit i jeho id (`spot` → `spotr` → `spot3`), jinak se na zařízení,
  kde hra běžela, nová hodnota nikdy neprojeví.

---

## ⚙ PANEL

Zorný úhel, sytost, barva/průhlednost/svítivost vody, obrys vody, **spotřeba
vody**, **barvy střely** (s živým náhledem dvou koulí), velikost korunky,
parametry trysky, síla zásahu do lahví, stíny a poloha světla, automatické
stříkání (na ladění) a posuvníky **život/voda** na ladění.
Vše v `localStorage` pod `ws_jet3d_tune`.

---

## CO JE ROZDĚLANÉ

1. **Výkon na telefonu není změřený** od doby, kdy přibyly mince, projektily,
   fleky a odkapávání. Na Macu drží 60 FPS. Podezřelí: draw cally (kolem 110
   až 150), SVG rozmazání při přejezdu, stínová mapa 2048.
2. **Obchod za mince neexistuje.** Mince se sbírají, ale nedají se utratit —
   to je celý smysl ekonomiky a chybí.
3. **`bandit_ducks.png` má 1,6 MB** na 1024×1024. Stačilo by 512² a WebP.
4. **Výchozí hodnoty v ⚙ panelu jsou pořád můj odhad** (zorný úhel, sytost,
   barva vody). Až si je uživatel doladí na telefonu, zapsat je do kódu.
5. **Truhly s vodou** — uživatel je zmínil jako hlavní zdroj vody místo lahví,
   nepostavené.
6. **Kompozice lahví losuje jen polohu**, ne typy.
7. Nevysvětlený **světle modrý pruh od otvoru dolů** ve 2D puzzlu.
