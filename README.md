# Political

A political values engine that matches people based on underlying priorities
rather than party identity, implemented as a single-page website with plain
HTML, CSS and JavaScript — no frameworks, no backend, no database, no login.

The questionnaire is built exactly to the design paper
(`design-paper.md` / the comprehensive UK questionnaire design document):
125 neutral 7-point questions plus ranking, multiple-choice and scenario
items, scored across 17 hidden ideological axes and compared against 8
party profiles (centre-left to extreme-left, centre-right to extreme-right)
using cosine similarity with credibility adjustments.

## Running it

Open `index.html` in any browser. Everything runs locally; progress is
autosaved to `localStorage` on the device.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Single-page shell: intro → one question at a time → results dashboard |
| `styles.css` | Minimal black-and-white, mobile-first styling |
| `config.js` | **The single editable object**: every question, axis, weighting, party profile, credibility weight, explanation template, contradiction rule and scoring constant |
| `engine.js` | The scoring model: answer conversion `v = (answer − 4) / 3`, weighted axis accumulation with absolute-weight normalisation, cosine similarity, credibility adjustment, confidence score, contradiction/tension detection, influence and uncertainty analysis |
| `app.js` | UI flow: navigation, progress bar, transitions, keyboard and touch support (including drag-to-rank), autosave/resume, and the results dashboard with horseshoe and radar visualisations |

## Expanding or recalibrating

Edit `config.js` only. Add questions (any of the four types), tune axis
weights, adjust party vectors or credibility weights, add explanation
templates or contradiction rules — the application logic adapts
automatically. Every scoring constant lives in `CONFIG.scoring`.

## Features

- [x] 125-question engine (plus ranking / choice / scenario items)
- [x] Hidden scoring model (17 axes, cosine matching, credibility weights)
- [x] Circular political map (horseshoe visualisation)
- [x] Party comparison (top four matches with percentages and confidence)
- [x] Custom analysis engine (personalised written analysis, contradictions,
      trade-offs, influential answers, uncertain values, psychological profile)
