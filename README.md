# Star Trek Trivia

A self-contained, LCARS-styled Star Trek trivia game that runs locally in any modern browser — no installer, no server, no `npm install`. Just double-click `index.html`.

**🖖 Live demo: https://ryanramer.github.io/Star_Trek_Trivia/**

**600 canon-verified questions** spanning four series: TOS, TNG, DS9, and VOY. Every question includes a brief explanation citing the relevant episode or film.

---

## How to play

Play online at **https://ryanramer.github.io/Star_Trek_Trivia/**, or run it locally:

1. Clone or download the repo.
2. Double-click `index.html`.
3. Pick filters (series, difficulty, category, question count, question type) and hit **ENGAGE**.

Tested in Edge, Chrome, and Firefox on Windows 11. Should work in any modern browser.

---

## Content overview

| Series | Easy | Medium | Hard | Total |
|---|---:|---:|---:|---:|
| TOS — The Original Series | 50 | 50 | 50 | 150 |
| TNG — The Next Generation | 50 | 50 | 50 | 150 |
| DS9 — Deep Space Nine | 50 | 50 | 50 | 150 |
| VOY — Voyager | 50 | 50 | 50 | 150 |
| **Total** | **200** | **200** | **200** | **600** |

Each series mixes multiple-choice and true/false questions across 10 categories: Characters & Crew, Ships & Technology, Alien Species & Cultures, Villains & Antagonists, Episodes & Story Arcs, Quotes & Catchphrases, Starfleet Ranks & Protocol, Planets & Locations, Timeline & History, and Crossovers & Connections.

---

## Editing or adding questions

The browser cannot read JSON files directly from `file://` (CORS restriction), so the source JSON files are bundled into `data.js` by a small PowerShell build script.

To add or edit questions:

1. Edit the relevant `*_trivia.json` file. Each question is an object with this shape:
   ```json
   {
     "id": "TOS-101",
     "series": "TOS",
     "difficulty": "easy",
     "type": "multiple_choice",
     "category": "Characters & Crew",
     "question": "...",
     "answers": { "A": "...", "B": "...", "C": "...", "D": "..." },
     "correct": "B",
     "explanation": "Brief context citing the canon source."
   }
   ```
   For true/false questions use `"type": "true_false"` and only keys `A` (True) and `B` (False) in `answers`.

2. Run the build script from PowerShell:
   ```powershell
   .\build_data.ps1
   ```
   This regenerates `data.js` from all four source files. Output is logged to console and to `build_data.log`.

3. Reload `index.html` in your browser.

---

## Anti-spoiler logic

Because every question shows its correct answer and an explanation as feedback, two
questions in the same session can leak each other's answers — e.g. a question about a
Dominion War battle, followed by "What was the major war in DS9?" To prevent this, the
app builds a **conflict graph** once at load and then picks each session greedily,
never placing two conflicting questions in the same run.

Conflicts come from three sources:

1. **Automatic (no maintenance):** a question's correct-answer term is treated as a
   spoiler when it is *distinctive* — at least 5 characters and appearing in at most 3
   questions' revealing text (the question, its explanation, and its correct answer;
   wrong distractors are ignored). Any other question whose revealing text contains
   that term is marked as conflicting. Ubiquitous terms like "Vulcan" or "Kirk" exceed
   the frequency cap and are correctly ignored. (~99 conflict pairs across the current
   600 questions.)
2. **`conflictsWith`** — an optional array on any question to force-exclude specific
   ids, e.g. `"conflictsWith": ["DS9-100"]`.
3. **`topic`** — an optional cluster tag, e.g. `"topic": "dominion-war"`. All questions
   sharing a topic conflict. This is the lever for *semantic* leaks that share no
   literal answer text (which the automatic layer cannot detect).

If a filtered pool is too small to fill the requested count without conflicts, the app
backfills from the remaining questions and logs a `WARN` rather than under-delivering.
The thresholds live in `app.js` as `SPOILER_MIN_LEN` and `SPOILER_FREQ_MAX`.

---

## Tests

The game runs without any tooling, but a test suite guards the two things most likely
to regress: the question data and the anti-spoiler logic. Running the tests requires
[Node.js](https://nodejs.org) (the tests use Node's built-in runner — **no `npm install`,
no dependencies**). With Node on your PATH:

```bash
npm test
```

The suite (`tests/`) covers:

- **Data integrity** (`data-integrity.test.js`) — each series has exactly 150 questions
  with a 50/50/50 difficulty split; IDs are sequential and unique; no duplicate question
  text; every question has a valid schema (categories, answer keys, `correct` present,
  correct option count per type); and `data.js` is in sync with the source JSON files
  (fails if you edited a `*_trivia.json` without re-running `build_data.ps1`).
- **Anti-spoiler logic** (`anti-spoiler.test.js`) — exercises the *real* functions
  exported from `app.js` (no re-implemented copy): the conflict graph is symmetric,
  known leak pairs are caught, ubiquitous terms don't over-link, the `conflictsWith`/
  `topic` overrides work, a generated session never contains a conflicting pair (200
  randomized runs), and backfill still delivers the requested count on a too-narrow pool.

`app.js` exports those functions only under CommonJS (`module.exports`), so the export
block is a harmless no-op in the browser.

---

## Project structure

```
.
├── index.html          # Main app — open this to play
├── styles.css          # LCARS-inspired theme
├── app.js              # Game logic + verbose console logging
├── data.js             # Generated bundle of all 600 questions
├── build_data.ps1      # Regenerates data.js from the *_trivia.json files
├── tos_trivia.json     # Source: TOS questions
├── tng_trivia.json     # Source: TNG questions
├── ds9_trivia.json     # Source: DS9 questions
├── voy_trivia.json     # Source: VOY questions
├── package.json        # npm test script (Node built-in test runner)
├── tests/              # Data-integrity and anti-spoiler tests
└── .gitignore
```

---

## Quality notes

Every answer was reviewed by independent canon-verification passes against Memory Alpha conventions. The expansion to 600 questions added a fresh per-series adversarial fact-check that caught and fixed issues such as a malformed Voyager question, a misnamed actress (Diana Muldaur), the USS Rio Grande registry (NCC-72452), the number of Weyoun clones, and several stray episode/citation errors. Known issues found in earlier drafts (e.g., `qapla'` mistranslation, the Doctor's "Latent Image" dilemma, Lursa & B'Etor's DS9 appearance) remain corrected. If you spot a remaining canon error, open an issue or edit the JSON and re-run the build script.

Live long and prosper.

---

## License

The code in this repository is released under the [MIT License](LICENSE).

## Disclaimer

This is an unofficial, non-commercial fan project. *Star Trek* and all related marks,
characters, and names are trademarks of Paramount / CBS Studios Inc. This game is not
affiliated with, endorsed by, or sponsored by the rights holders. All trivia content is
provided for educational and entertainment purposes. The MIT license above applies to the
project's own source code, not to any *Star Trek* trademarks or franchise material.
