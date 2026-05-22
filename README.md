# Star Trek Trivia

A self-contained, LCARS-styled Star Trek trivia game that runs locally in any modern browser — no installer, no server, no `npm install`. Just double-click `index.html`.

**440 canon-verified questions** spanning four series: TOS, TNG, DS9, and VOY. Every question includes a brief explanation citing the relevant episode or film.

---

## How to play

1. Clone or download the repo.
2. Double-click `index.html`.
3. Pick filters (series, difficulty, category, question count, question type) and hit **ENGAGE**.

Tested in Edge, Chrome, and Firefox on Windows 11. Should work in any modern browser.

---

## Content overview

| Series | Easy | Medium | Hard | Total |
|---|---:|---:|---:|---:|
| TOS — The Original Series | 33 | 33 | 44 | 110 |
| TNG — The Next Generation | 33 | 33 | 44 | 110 |
| DS9 — Deep Space Nine | 33 | 33 | 44 | 110 |
| VOY — Voyager | 33 | 33 | 44 | 110 |
| **Total** | **132** | **132** | **176** | **440** |

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

## Project structure

```
.
├── index.html          # Main app — open this to play
├── styles.css          # LCARS-inspired theme
├── app.js              # Game logic + verbose console logging
├── data.js             # Generated bundle of all 440 questions
├── build_data.ps1      # Regenerates data.js from the *_trivia.json files
├── tos_trivia.json     # Source: TOS questions
├── tng_trivia.json     # Source: TNG questions
├── ds9_trivia.json     # Source: DS9 questions
├── voy_trivia.json     # Source: VOY questions
└── .gitignore
```

---

## Quality notes

Every answer was reviewed by independent canon-verification passes against Memory Alpha conventions. Known issues found in earlier drafts (e.g., `qapla'` mistranslation, the Doctor's "Latent Image" dilemma, Lursa & B'Etor's DS9 appearance) have been corrected. If you spot a remaining canon error, open an issue or edit the JSON and re-run the build script.

Live long and prosper.
