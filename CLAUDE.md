# Water Shoot — orientace pro Claude

Prototyp pouťové střílečky pro Gamee platformu: vodní dělo dole stříká na kachničky/terče,
které projíždějí zleva/zprava nebo se objevují na čas. Hlavní účel = **test vodní fyziky
na mobilech** (particle systém, kolik toho telefony unesou). Vanilla JS, canvas, žádný build step.

Struktura a workflow zrcadlí sesterský projekt `~/CodeProjects/ballon-belt`.

## Backlog

Na začátku session se podívej do [BACKLOG.md](BACKLOG.md). Po každém commitu `vXX: ...`
zapiš řádek do sekce „Hotovo".

## Struktura

```
gamee/
├── index.html           prod entry (loads lib/gamee-js.min.js)
├── index_local.html     dev entry (loads lib/gamee-js-stub.js) ← otevřít v prohlížeči
├── css/game.css         stylování
├── js/game.js           veškerá herní logika + particle systém
└── lib/
    ├── gamee-js.min.js  reálný Gamee SDK (nedotýkat, kopie z ballon-belt)
    └── gamee-js-stub.js stub auto-fires 'start' event pro lokální dev
server.py                dev server — PORT 8090 (8080 má ballon-belt!)
```

`index.html` a `index_local.html` udržovat synchronní AŽ NA: SDK script (min vs stub)
a načítání skriptů (prod `?v=X`, dev `?t=` cache-bust).

## Dev workflow

1. Práce ve worktree milníkové větve: `.claude/worktrees/<větev>/gamee/`
2. Server: `python3 server.py` z rootu main repa — **port 8090**, docroot = root repa,
   no-cache hlavičky. Servíruje repo přímo včetně worktrees:
   - main repo: `http://localhost:8090/gamee/index_local.html`
   - worktree LIVE: `http://localhost:8090/.claude/worktrees/<větev>/gamee/index_local.html`
3. **Pozor na kolize portů** — běží víc projektů (8080 ballon-belt, 8001, 5175, 5000, 7000).
   Před startem ověř `lsof -nP -iTCP:8090 -sTCP:LISTEN`. Cizí servery nerušit.
4. Force refresh: Cmd+Shift+R. Vždy zkontroluj version badge.

## Post-commit checklist (VŽDY po commitu)

Po každém commitu `vXX: ...`:

**A) Bump verze na `vYY`:**
1. `gamee/index.html` + `gamee/index_local.html` — `<title>` + version badge
2. `gamee/js/game.js` — `const WS_VERSION = 'vYY'` + checksum string `'water-shoot-vYY'` (hledej `gamee.updateScore`)
3. `gamee/index.html` — `?v=YY` query stringy

**B) Zápis do [BACKLOG.md](BACKLOG.md)** — řádek do „Hotovo" s hashem + datem.

## Gamee deployment

```bash
cd gamee && rm -f ../water-shoot-gamee.zip && zip -r ../water-shoot-gamee.zip . -x "index_local.html" "lib/gamee-js-stub.js" "*.DS_Store"
```

Upload do Gamee admin (zip musí mít `index.html` v rootu).

## Konvence

- **Jazyk komunikace**: česky (nikdy slovensky)
- **Commit message**: začíná `vXX: ...`
- **Game checksum**: `water-shoot-vXX`, bumpuje se s každou verzí
- **Git režim (viz memory collaboration-guide v ballon-belt)**: NIKDY nepsat do `master`.
  Práce na milníkové větvi ve worktree (`git worktree add .claude/worktrees/<větev> -b <větev> master`),
  název = milník + pořadové číslo (např. `m01-vodni-proto-01`), schvaluje uživatel.
  Commit průběžně; push/PR/merge jen na výslovný pokyn. Jedna dodávka = jeden PR.
- **Plan files**: `~/.claude/plans/`
