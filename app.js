/* ==========================================================================
   APP.JS — USER INTERFACE AND FLOW
   ==========================================================================
   Everything DOM-related lives here:

     - screen management (intro → one-question-at-a-time → results)
     - rendering each question type (likert / choice / scenario / rank)
     - progress bar, question counter, back/next navigation
     - smooth transitions between questions
     - keyboard support (1–7 answers, ← back, → / Enter next)
     - touch support (large tap targets; pointer-based drag-to-rank)
     - autosave to localStorage after every interaction, with resume
     - rendering the full results dashboard, including the horseshoe
       and radar visualisations (hand-built SVG, no libraries)
     - assembling the personalised written analysis

   No scoring happens here — app.js only calls Engine.computeResults()
   and renders whatever comes back. No content lives here either — all
   words and numbers come from CONFIG.
   ========================================================================== */

"use strict";

(() => {

  /* =====================================================================
     STATE & PERSISTENCE
     ===================================================================== */

  // localStorage key. Bump the suffix if the answer format ever changes.
  const STORAGE_KEY = "values-assessment-v1";

  // Milliseconds before auto-advancing after a fresh likert/choice answer.
  const AUTO_ADVANCE_MS = 350;
  // Duration of the question card leave/enter transition (matches CSS).
  const TRANSITION_MS = 250;

  const state = {
    answers: {},     // question id → answer record (see engine.js for shapes)
    index: 0,        // which question is on screen
    finished: false  // true once results have been produced
  };

  let autoAdvanceTimer = null; // pending auto-advance, cancelled on navigation

  /** Persist the whole session. Called after every answer and navigation. */
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        answers: state.answers,
        index: state.index,
        finished: state.finished,
        savedAt: Date.now()
      }));
    } catch (e) { /* storage full/blocked — the quiz still works, just unsaved */ }
  }

  /** Restore a previous session, if any. Returns true when progress exists. */
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object" || !data.answers) return false;
      state.answers = data.answers;
      state.index = Math.min(Number(data.index) || 0, CONFIG.questions.length - 1);
      state.finished = Boolean(data.finished);
      return Object.keys(state.answers).length > 0 || state.finished;
    } catch (e) { return false; }
  }

  function clearState() {
    state.answers = {};
    state.index = 0;
    state.finished = false;
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  }

  /* =====================================================================
     SMALL HELPERS
     ===================================================================== */

  const $ = id => document.getElementById(id);

  /** Escape a string for interpolation into innerHTML. */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
  }

  /** Create an element with a class and optional text. */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** Round to a percentage string. */
  const pct = x => Math.round(x) + "%";

  /* =====================================================================
     SCREEN MANAGEMENT
     ===================================================================== */

  const screens = { intro: null, question: null, results: null };

  function showScreen(name) {
    for (const key in screens) screens[key].hidden = (key !== name);
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }

  /* =====================================================================
     INTRO SCREEN
     ===================================================================== */

  function renderIntro(hasProgress) {
    $("intro-heading").textContent = CONFIG.ui.introHeading;
    document.title = CONFIG.ui.siteTitle;

    const intro = $("intro-text");
    intro.innerHTML = "";
    CONFIG.ui.introText.forEach(par => intro.appendChild(el("p", null, par)));

    $("keyboard-hint").textContent = CONFIG.ui.keyboardHint;
    $("btn-start").textContent = CONFIG.ui.startButton;
    $("btn-resume").textContent = CONFIG.ui.resumeButton;
    $("btn-restart").textContent = CONFIG.ui.restartButton;

    // When saved progress exists, lead with "Continue" and offer a restart.
    $("btn-resume").hidden = !hasProgress;
    $("btn-restart").hidden = !hasProgress;
    $("btn-start").hidden = hasProgress;
  }

  /* =====================================================================
     QUESTION SCREEN
     ===================================================================== */

  function currentQuestion() { return CONFIG.questions[state.index]; }

  /** Is the current question answered (so Next can be enabled)? */
  function isAnswered(question) {
    const record = state.answers[question.id];
    if (!record) return false;
    if (question.type === "likert") return record.answer >= 1 && record.answer <= 7;
    if (question.type === "choice" || question.type === "scenario")
      return Number.isInteger(record.optionIndex);
    if (question.type === "rank") return Array.isArray(record.order);
    return false;
  }

  function updateChrome() {
    const total = CONFIG.questions.length;
    $("question-counter").textContent = CONFIG.ui.questionCounter
      .replace("{current}", state.index + 1)
      .replace("{total}", total);

    const percent = (state.index / total) * 100;
    $("progress-bar").style.width = percent + "%";
    $("progress-track").setAttribute("aria-valuenow", Math.round(percent));

    $("btn-back").textContent = CONFIG.ui.backButton;
    $("btn-back").disabled = state.index === 0;
    $("btn-next").textContent =
      state.index === total - 1 ? CONFIG.ui.finishButton : CONFIG.ui.nextButton;
    $("btn-next").disabled = !isAnswered(currentQuestion());
  }

  /**
   * Render the current question into the card.
   * `direction` ("forward" | "backward" | null) drives the slide transition.
   */
  function renderQuestion(direction) {
    const card = $("question-card");
    const question = currentQuestion();

    const paint = () => {
      // Scenario questions show their situation text above the question.
      const situation = $("question-situation");
      if (question.type === "scenario") {
        situation.textContent = question.situation;
        situation.hidden = false;
      } else {
        situation.hidden = true;
      }

      $("question-text").textContent = question.text;

      const area = $("answer-area");
      area.innerHTML = "";
      if (question.type === "likert") renderLikert(area, question);
      else if (question.type === "choice" || question.type === "scenario")
        renderChoice(area, question);
      else if (question.type === "rank") renderRank(area, question);

      updateChrome();
    };

    if (!direction) { paint(); return; }

    // Slide the old content out, swap, slide the new content in.
    card.classList.add("leaving-" + direction);
    setTimeout(() => {
      paint();
      card.classList.remove("leaving-" + direction);
      card.classList.add("entering-" + direction);
      // Force a reflow so the entering class takes effect before removal.
      void card.offsetWidth;
      card.classList.remove("entering-" + direction);
    }, TRANSITION_MS);
  }

  /* ---------- likert (7-point agree/disagree) ---------- */

  function renderLikert(area, question) {
    const wrap = el("div", "likert");
    const record = state.answers[question.id];

    CONFIG.ui.likertLabels.forEach((label, i) => {
      const value = i + 1; // 1..7
      const btn = el("button", "likert-option");
      btn.type = "button";
      btn.setAttribute("aria-pressed", record && record.answer === value);
      if (record && record.answer === value) btn.classList.add("selected");

      const key = el("span", "key", String(value));
      btn.appendChild(key);
      btn.appendChild(document.createTextNode(label));

      btn.addEventListener("click", () => selectLikert(question, value));
      wrap.appendChild(btn);
    });
    area.appendChild(wrap);
  }

  function selectLikert(question, value) {
    const wasAnswered = isAnswered(question);
    state.answers[question.id] = { answer: value };
    saveState();

    // Repaint the selection state without a full transition.
    const buttons = $("answer-area").querySelectorAll(".likert-option");
    buttons.forEach((btn, i) => {
      btn.classList.toggle("selected", i + 1 === value);
      btn.setAttribute("aria-pressed", i + 1 === value);
    });
    updateChrome();

    // Auto-advance keeps the flow brisk — but only on a first answer, so
    // someone reviewing an earlier answer isn't yanked forward.
    if (!wasAnswered) scheduleAutoAdvance();
  }

  /* ---------- multiple choice & scenario ---------- */

  function renderChoice(area, question) {
    const wrap = el("div", "choice");
    const record = state.answers[question.id];

    question.options.forEach((option, i) => {
      const btn = el("button", "choice-option", option.label);
      btn.type = "button";
      if (record && record.optionIndex === i) btn.classList.add("selected");
      btn.setAttribute("aria-pressed", Boolean(record && record.optionIndex === i));
      btn.addEventListener("click", () => selectChoice(question, i));
      wrap.appendChild(btn);
    });
    area.appendChild(wrap);
  }

  function selectChoice(question, optionIndex) {
    const wasAnswered = isAnswered(question);
    state.answers[question.id] = { optionIndex };
    saveState();

    const buttons = $("answer-area").querySelectorAll(".choice-option");
    buttons.forEach((btn, i) => {
      btn.classList.toggle("selected", i === optionIndex);
      btn.setAttribute("aria-pressed", i === optionIndex);
    });
    updateChrome();
    if (!wasAnswered) scheduleAutoAdvance();
  }

  /* ---------- drag-to-rank ---------- */

  function renderRank(area, question) {
    // The current order: previously saved, or the config's default order.
    let record = state.answers[question.id];
    if (!record) {
      record = { order: question.items.map(item => item.id) };
      state.answers[question.id] = record; // a default order is a valid answer
      saveState();
    }

    area.appendChild(el("p", "rank-hint", CONFIG.ui.rankHint));

    const list = el("ul", "rank-list");
    list.setAttribute("role", "listbox");
    area.appendChild(list);

    const paintList = () => {
      list.innerHTML = "";
      record.order.forEach((itemId, position) => {
        const item = question.items.find(it => it.id === itemId);
        const li = el("li", "rank-item");
        li.dataset.itemId = itemId;

        li.appendChild(el("span", "rank-pos", String(position + 1)));
        li.appendChild(el("span", "rank-label", item.label));
        li.appendChild(el("span", "rank-grip", "⋮⋮"));

        // Up/down buttons: keyboard- and screen-reader-friendly fallback
        // to dragging, and handy on small touch screens too.
        const btns = el("span", "rank-btns");
        const up = el("button", "rank-move", "↑");
        up.type = "button";
        up.disabled = position === 0;
        up.setAttribute("aria-label", "Move " + item.label + " up");
        up.addEventListener("click", e => { e.stopPropagation(); move(position, position - 1); });
        const down = el("button", "rank-move", "↓");
        down.type = "button";
        down.disabled = position === record.order.length - 1;
        down.setAttribute("aria-label", "Move " + item.label + " down");
        down.addEventListener("click", e => { e.stopPropagation(); move(position, position + 1); });
        btns.appendChild(up);
        btns.appendChild(down);
        li.appendChild(btns);

        attachDrag(li);
        list.appendChild(li);
      });
    };

    const move = (from, to) => {
      if (to < 0 || to >= record.order.length) return;
      const [moved] = record.order.splice(from, 1);
      record.order.splice(to, 0, moved);
      saveState();
      paintList();
    };

    /* Pointer-based dragging: works for mouse, touch and pen alike.
       While dragging we visually float the element and live-reorder the
       list whenever the pointer crosses a sibling's midpoint. */
    const attachDrag = li => {
      li.addEventListener("pointerdown", startEvent => {
        if (startEvent.target.closest(".rank-move")) return; // buttons handle themselves
        startEvent.preventDefault();
        li.setPointerCapture(startEvent.pointerId);
        li.classList.add("dragging");

        const onMove = moveEvent => {
          const y = moveEvent.clientY;
          // Find the sibling whose midpoint the pointer has crossed.
          for (const sibling of [...list.children]) {
            if (sibling === li) continue;
            const box = sibling.getBoundingClientRect();
            const midpoint = box.top + box.height / 2;
            const liIndex = [...list.children].indexOf(li);
            const sibIndex = [...list.children].indexOf(sibling);
            if (sibIndex < liIndex && y < midpoint) {
              list.insertBefore(li, sibling);
              break;
            }
            if (sibIndex > liIndex && y > midpoint) {
              sibling.after(li);
              break;
            }
          }
        };

        const onUp = () => {
          li.classList.remove("dragging");
          li.removeEventListener("pointermove", onMove);
          li.removeEventListener("pointerup", onUp);
          li.removeEventListener("pointercancel", onUp);
          // Persist the new DOM order, then repaint to fix the numbers.
          record.order = [...list.children].map(node => node.dataset.itemId);
          saveState();
          paintList();
        };

        li.addEventListener("pointermove", onMove);
        li.addEventListener("pointerup", onUp);
        li.addEventListener("pointercancel", onUp);
      });
    };

    paintList();
    updateChrome(); // a rank question is answerable immediately
  }

  /* ---------- navigation ---------- */

  function scheduleAutoAdvance() {
    cancelAutoAdvance();
    autoAdvanceTimer = setTimeout(() => { autoAdvanceTimer = null; goNext(); },
                                  AUTO_ADVANCE_MS);
  }

  function cancelAutoAdvance() {
    if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  }

  function goNext() {
    cancelAutoAdvance();
    if (!isAnswered(currentQuestion())) return;
    if (state.index === CONFIG.questions.length - 1) { finish(); return; }
    state.index += 1;
    saveState();
    renderQuestion("forward");
  }

  function goBack() {
    cancelAutoAdvance();
    if (state.index === 0) return;
    state.index -= 1;
    saveState();
    renderQuestion("backward");
  }

  /* ---------- keyboard support ---------- */

  function onKeyDown(event) {
    if (screens.question.hidden) return;
    // Don't hijack keys while a button has focus and space is pressed, etc.
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const question = currentQuestion();

    if (event.key >= "1" && event.key <= "9") {
      const n = Number(event.key);
      if (question.type === "likert" && n >= 1 && n <= 7) {
        selectLikert(question, n);
        event.preventDefault();
      } else if ((question.type === "choice" || question.type === "scenario") &&
                 n <= question.options.length) {
        selectChoice(question, n - 1);
        event.preventDefault();
      }
    } else if (event.key === "ArrowRight" || event.key === "Enter") {
      // Ignore Enter when it is activating a focused button natively.
      if (event.key === "Enter" && document.activeElement &&
          document.activeElement.tagName === "BUTTON") return;
      goNext();
      event.preventDefault();
    } else if (event.key === "ArrowLeft") {
      goBack();
      event.preventDefault();
    }
  }

  /* =====================================================================
     RESULTS DASHBOARD
     ===================================================================== */

  function finish() {
    state.finished = true;
    saveState();
    const results = Engine.computeResults(state.answers);
    renderResults(results);
    showScreen("results");
  }

  /** Human word for how strongly an axis is held. */
  function intensityWord(score) {
    const a = Math.abs(score);
    if (a >= 0.6) return "strongly";
    if (a >= CONFIG.scoring.strongAxisThreshold) return "clearly";
    if (a >= CONFIG.scoring.moderateAxisThreshold) return "moderately";
    return "mildly";
  }

  /** "equality — egalitarian, pro-redistribution" style phrase. */
  function axisLean(axisCode, score) {
    const axis = CONFIG.axes[axisCode];
    const pole = score >= 0 ? axis.positive : axis.negative;
    return { name: axis.name, pole: pole.charAt(0).toLowerCase() + pole.slice(1) };
  }

  function renderResults(results) {
    $("results-heading").textContent = CONFIG.ui.resultsHeading;
    $("analysis-heading").textContent = CONFIG.ui.analysisHeading;
    $("disclaimer").textContent = CONFIG.ui.disclaimer;

    renderBestMatch(results);
    renderMatchList(results);
    renderHorseshoe(results);
    renderRadar(results);
    renderAxisList(results);
    renderPsychology(results);
    renderPriorities(results);
    renderTradeoffs(results);
    renderContradictions(results);
    renderAnalysis(results);
    renderInfluences(results);
    renderUncertain(results);
  }

  /* ---------- best match + confidence ---------- */

  function renderBestMatch(results) {
    const { best, confidence } = results;
    const box = $("best-match");
    box.innerHTML =
      '<p class="results-kicker">Best matching party</p>' +
      '<p class="match-name">' + esc(best.party.name) + "</p>" +
      '<p class="match-family">' + esc(best.party.family) + "</p>" +
      '<div class="best-stats">' +
        '<div class="best-stat"><div class="stat-value">' + best.percent + '%</div>' +
          '<div class="stat-label">Match</div></div>' +
        '<div class="best-stat"><div class="stat-value">' + confidence + '%</div>' +
          '<div class="stat-label">Confidence</div></div>' +
      "</div>" +
      '<p class="match-desc">' + esc(best.party.description) + "</p>";
  }

  /* ---------- top four matches ---------- */

  function renderMatchList(results) {
    const listEl = $("match-list");
    listEl.innerHTML = "";
    results.matches.slice(0, CONFIG.scoring.topPartyCount).forEach(match => {
      const row = el("div", "match-row");
      row.innerHTML =
        "<div><div class='match-row-name'>" + esc(match.party.name) + "</div>" +
        "<div class='match-row-family'>" + esc(match.party.family) + "</div></div>" +
        "<div class='match-row-pct'>" + match.percent + "%</div>" +
        "<div class='match-row-bar'><div style='width:" + match.percent + "%'></div></div>";
      listEl.appendChild(row);
    });
  }

  /* ---------- circular horseshoe visualisation ----------
     The spectrum is drawn as a 240° arc: far-left at the lower-left tip,
     centre at the top, far-right at the lower-right tip — so the two
     extremes curve toward each other (the horseshoe model). Party dots
     sit at their CONFIG spectrum positions; the user's marker is a
     match-weighted average of party positions, sharpened so the top
     matches dominate. */
  function renderHorseshoe(results) {
    const W = 460, H = 265, cx = W / 2, cy = 165, r = 112;

    // spectrum position t (0..1) → point on the arc (210° → -30°).
    const point = t => {
      const deg = 210 - 240 * t;
      const rad = (deg * Math.PI) / 180;
      return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
    };

    // User position: weights are the credibility-adjusted match scores,
    // rescaled to [0,1] then cubed so near-misses barely pull the marker.
    const adjusted = results.matches.map(m => m.adjusted);
    const min = Math.min(...adjusted), max = Math.max(...adjusted);
    let weightSum = 0, tSum = 0;
    results.matches.forEach(m => {
      const w = Math.pow(max > min ? (m.adjusted - min) / (max - min) : 1, 3);
      weightSum += w;
      tSum += w * m.party.spectrum;
    });
    const userT = weightSum > 0 ? tSum / weightSum : 0.5;
    const userPt = point(userT);

    const a = point(0), b = point(1);
    let svg =
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" ' +
      'aria-label="Horseshoe political spectrum with your position marked">' +
      // the arc itself (large-arc flag on, sweep clockwise)
      '<path d="M ' + a.x.toFixed(1) + " " + a.y.toFixed(1) +
      " A " + r + " " + r + " 0 1 1 " + b.x.toFixed(1) + " " + b.y.toFixed(1) +
      '" fill="none" stroke="#ddd" stroke-width="10" stroke-linecap="round"/>' +
      // pole labels at the two tips
      '<text x="' + (a.x - 2) + '" y="' + (a.y + 22) +
      '" font-size="10" fill="#9a9a9a" text-anchor="middle">Far left</text>' +
      '<text x="' + (b.x + 2) + '" y="' + (b.y + 22) +
      '" font-size="10" fill="#9a9a9a" text-anchor="middle">Far right</text>';

    // Party dots and labels, placed just outside the arc. Label x positions
    // are clamped (using an approximate text width) so long party names
    // never fall outside the viewBox and get clipped.
    CONFIG.parties.forEach(party => {
      const p = point(party.spectrum);
      const labelR = r + 22;
      const deg = 210 - 240 * party.spectrum;
      const rad = (deg * Math.PI) / 180;
      let lx = cx + labelR * Math.cos(rad);
      const ly = cy - labelR * Math.sin(rad);
      const anchor = lx < cx - 8 ? "end" : lx > cx + 8 ? "start" : "middle";
      const approxWidth = party.name.length * 5.4; // ~width at font-size 9.5
      if (anchor === "end") lx = Math.max(lx, approxWidth + 4);
      else if (anchor === "start") lx = Math.min(lx, W - approxWidth - 4);
      else lx = Math.min(Math.max(lx, approxWidth / 2 + 4), W - approxWidth / 2 - 4);
      const isTop = party.id === results.best.party.id;
      svg +=
        '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) +
        '" r="' + (isTop ? 7 : 5) + '" fill="' + (isTop ? "#111" : "#fff") +
        '" stroke="#111" stroke-width="1.5"/>' +
        '<text x="' + lx.toFixed(1) + '" y="' + (ly + 3).toFixed(1) +
        '" font-size="9.5" fill="' + (isTop ? "#111" : "#555") +
        '" text-anchor="' + anchor + '"' +
        (isTop ? ' font-weight="bold"' : "") + ">" + esc(party.name) + "</text>";
    });

    // The user's marker: a filled dot with a halo ring.
    svg +=
      '<circle cx="' + userPt.x.toFixed(1) + '" cy="' + userPt.y.toFixed(1) +
      '" r="12" fill="none" stroke="#111" stroke-width="1.5" stroke-dasharray="3 3"/>' +
      '<circle cx="' + userPt.x.toFixed(1) + '" cy="' + userPt.y.toFixed(1) +
      '" r="6" fill="#111"/>' +
      '<text x="' + userPt.x.toFixed(1) + '" y="' + (userPt.y + 28).toFixed(1) +
      '" font-size="10" font-weight="bold" fill="#111" text-anchor="middle">You</text>' +
      "</svg>";

    $("horseshoe").innerHTML = svg;
  }

  /* ---------- circular radar of all hidden axes ----------
     Each axis is a spoke. The mid ring is zero; scores from -1 to +1 map
     from the centre out to the rim. Clicking an axis label opens the
     matching explanation row below the chart. */
  function renderRadar(results) {
    const axes = Engine.AXES;
    const W = 340, H = 340, cx = W / 2, cy = H / 2;
    const rMax = 120, rZero = rMax / 2; // score 0 sits halfway out

    const spoke = (i, radius) => {
      const angle = (2 * Math.PI * i) / axes.length - Math.PI / 2;
      return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
    };
    const scoreRadius = s => rZero + (s * rMax) / 2;

    let svg =
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" ' +
      'aria-label="Circular chart of your scores on every hidden axis">';

    // Reference rings for -1 (centre-most), 0 and +1.
    [rZero / 2, rZero, rMax].forEach((radius, idx) => {
      svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + radius +
             '" fill="none" stroke="#e6e6e6" stroke-width="' +
             (idx === 1 ? 1.5 : 1) + '"' +
             (idx === 1 ? "" : ' stroke-dasharray="3 3"') + "/>";
    });

    // Spokes.
    axes.forEach((axis, i) => {
      const end = spoke(i, rMax);
      svg += '<line x1="' + cx + '" y1="' + cy + '" x2="' + end.x.toFixed(1) +
             '" y2="' + end.y.toFixed(1) + '" stroke="#f0f0f0" stroke-width="1"/>';
    });

    // The user's polygon.
    const points = axes.map((axis, i) => {
      const p = spoke(i, scoreRadius(results.profile.scores[axis]));
      return p.x.toFixed(1) + "," + p.y.toFixed(1);
    }).join(" ");
    svg += '<polygon points="' + points +
           '" fill="rgba(17,17,17,0.10)" stroke="#111" stroke-width="1.8"/>';

    // Dots + clickable code labels.
    axes.forEach((axis, i) => {
      const p = spoke(i, scoreRadius(results.profile.scores[axis]));
      svg += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) +
             '" r="3" fill="#111"/>';
      const label = spoke(i, rMax + 16);
      svg += '<text x="' + label.x.toFixed(1) + '" y="' + (label.y + 3).toFixed(1) +
             '" font-size="9.5" fill="#555" text-anchor="middle" ' +
             'style="cursor:pointer" data-axis="' + axis + '">' + axis + "</text>";
    });
    svg += "</svg>";

    const holder = $("radar");
    holder.innerHTML = svg;
    // Clicking an axis code on the chart opens its explanation row.
    holder.querySelectorAll("text[data-axis]").forEach(node => {
      node.addEventListener("click", () => {
        const row = document.querySelector('.axis-row[data-axis="' + node.dataset.axis + '"]');
        if (row) {
          row.classList.add("open");
          row.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    });
  }

  /* ---------- interactive per-axis explanation rows ---------- */

  function renderAxisList(results) {
    const holder = $("axis-list");
    holder.innerHTML = "";

    Engine.AXES.forEach(code => {
      const axis = CONFIG.axes[code];
      const score = results.profile.scores[code];
      const lean = axisLean(code, score);
      const isUncertain = results.uncertain.includes(code);

      const row = el("div", "axis-row");
      row.dataset.axis = code;

      const reading = isUncertain
        ? "unclear"
        : intensityWord(score) + " " + (score >= 0 ? "towards" : "towards") + " " +
          (score >= 0 ? axis.positive.toLowerCase() : axis.negative.toLowerCase());

      // Personal sentence woven into the axis explanation.
      const personal = isUncertain
        ? "Your answers did not settle this dimension — you may be genuinely " +
          "torn, or it may simply matter less to you than the others."
        : "You lean " + intensityWord(score) + " towards “" + lean.pole + "”.";

      row.innerHTML =
        '<div class="axis-row-head">' +
          '<span class="axis-row-name">' + esc(axis.name) + " (" + code + ")</span>" +
          '<span class="axis-row-reading">' + esc(isUncertain ? "uncertain" : intensityWord(score)) + "</span>" +
        "</div>" +
        '<div class="axis-row-scale"><span class="mid"></span>' +
          '<span class="dot" style="left:' + (50 + score * 50) + '%"></span></div>' +
        '<div class="axis-row-poles"><span>' + esc(axis.negative) + "</span><span>" +
          esc(axis.positive) + "</span></div>" +
        '<div class="axis-row-detail">' + esc(axis.explanation) + " " + esc(personal) + "</div>";

      row.addEventListener("click", () => row.classList.toggle("open"));
      holder.appendChild(row);
    });
  }

  /* ---------- hidden psychological profile ---------- */

  function renderPsychology(results) {
    const holder = $("psychology");
    holder.innerHTML = "";
    results.psychology.forEach(entry => {
      const item = el("div", "psych-item");
      const bandLabel = entry.band === "high" ? entry.trait.highLabel
                      : entry.band === "low" ? entry.trait.lowLabel
                      : "Balanced";
      item.innerHTML =
        '<span class="psych-name">' + esc(entry.trait.name) + "</span>" +
        '<span class="psych-band">' + esc(bandLabel) + "</span>" +
        '<div class="psych-scale"><span class="dot" style="left:' +
          (50 + entry.value * 50) + '%"></span></div>' +
        '<div class="psych-poles"><span>' + esc(entry.trait.lowLabel) +
          "</span><span>" + esc(entry.trait.highLabel) + "</span></div>" +
        '<p class="psych-text">' + esc(entry.text) + "</p>";
      holder.appendChild(item);
    });
  }

  /* ---------- key priorities ---------- */

  function renderPriorities(results) {
    const holder = $("priorities");
    holder.innerHTML = "";
    const tags = el("div", "tag-list");
    results.priorities.forEach(p => {
      const lean = axisLean(p.axis, p.score);
      tags.appendChild(el("span", "tag",
        CONFIG.axes[p.axis].name + ": " + lean.pole));
    });
    holder.appendChild(tags);
  }

  /* ---------- main trade-offs ----------
     A trade-off exists when two of the user's strong values each pull
     hardest towards a *different* party — the result has to balance them.
     For each strong axis we find the party whose position on that axis,
     in the user's direction, is largest; pairs of strong axes with
     different "champions" are reported (up to three). */
  function renderTradeoffs(results) {
    const holder = $("tradeoffs");
    holder.innerHTML = "";

    const strong = results.priorities.filter(
      p => Math.abs(p.score) >= CONFIG.scoring.moderateAxisThreshold);

    const champion = p => {
      let bestParty = null, bestValue = -Infinity;
      CONFIG.parties.forEach(party => {
        const v = (party.vector[p.axis] || 0) * Math.sign(p.score);
        if (v > bestValue) { bestValue = v; bestParty = party; }
      });
      return bestParty;
    };

    const rows = [];
    for (let i = 0; i < strong.length && rows.length < 3; i++) {
      for (let j = i + 1; j < strong.length && rows.length < 3; j++) {
        const a = strong[i], b = strong[j];
        const pa = champion(a), pb = champion(b);
        if (pa && pb && pa.id !== pb.id) {
          const la = axisLean(a.axis, a.score), lb = axisLean(b.axis, b.score);
          rows.push(
            "Your leaning on " + la.name.toLowerCase() + " (" + la.pole +
            ") is served best by the " + pa.name + ", while your position on " +
            lb.name.toLowerCase() + " (" + lb.pole + ") points to the " +
            pb.name + ". Your final match balances the two."
          );
        }
      }
    }

    if (!rows.length) {
      holder.appendChild(el("p", "item-text",
        "Your strongest values all point in a similar political direction, " +
        "so your result involved no major trade-offs."));
      return;
    }
    rows.forEach(text => {
      const block = el("div", "item-block");
      block.appendChild(el("p", "item-text", text));
      holder.appendChild(block);
    });
  }

  /* ---------- contradictions & tensions ---------- */

  function renderContradictions(results) {
    const holder = $("contradictions");
    holder.innerHTML = "";

    const blocks = [];

    // Config-defined contradiction rules (the paper's insights).
    results.contradictions.forEach(rule => {
      blocks.push({ title: rule.title, text: rule.text });
    });

    // Generic user-vs-party tensions on individual axes.
    results.tensions.slice(0, 3).forEach(tension => {
      const axis = CONFIG.axes[tension.axis];
      const userLean = axisLean(tension.axis, tension.userScore);
      const partyLean = axisLean(tension.axis, tension.partyScore);
      blocks.push({
        title: "You and the " + results.best.party.name + " disagree on " +
               axis.name.toLowerCase(),
        text: "You lean " + intensityWord(tension.userScore) + " towards “" +
              userLean.pole + "”, while this party's platform sits closer to “" +
              partyLean.pole + "”. It matched you on your other priorities, " +
              "but expect friction here."
      });
    });

    if (!blocks.length) {
      holder.appendChild(el("p", "item-text",
        "No significant contradictions were detected between your stated " +
        "values, and none of your strong values conflict with your best " +
        "match's platform."));
      return;
    }
    blocks.forEach(b => {
      const block = el("div", "item-block");
      block.appendChild(el("p", "item-title", b.title));
      block.appendChild(el("p", "item-text", b.text));
      holder.appendChild(block);
    });
  }

  /* ---------- the detailed written analysis ----------
     Assembled from the results object so every sentence is grounded in
     this user's actual numbers: their priorities, the winning party's
     platform, the gaps that sank the runners-up, fired templates,
     contradictions and uncertain values. */
  function renderAnalysis(results) {
    const holder = $("analysis");
    holder.innerHTML = "";
    const paragraphs = [];
    const { best, matches } = results;

    /* Paragraph 1 — who this person is politically, from their top axes. */
    const leans = results.priorities.map(p => {
      const lean = axisLean(p.axis, p.score);
      return intensityWord(p.score) + " towards " + lean.pole +
             " on " + lean.name.toLowerCase();
    });
    paragraphs.push(
      "Reading your answers as a whole, a consistent picture emerges. " +
      "The dimensions that most define you are these: you lean " +
      leans.slice(0, 3).join("; ") +
      (leans.length > 3
        ? ". Beyond those, you also lean " + leans.slice(3).join("; ") + "."
        : ".") +
      " These are the values you returned to across many differently " +
      "worded questions, which is what gives them weight in your profile."
    );

    /* Paragraph 2 — the psychological reading, from the strongest traits. */
    const markedTraits = results.psychology
      .filter(entry => entry.band !== "mid")
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 3);
    if (markedTraits.length) {
      paragraphs.push(
        "Psychologically, your answer pattern suggests the following. " +
        markedTraits.map(entry => entry.text).join(" ") +
        " None of this is about left or right — it is about how you " +
        "instinctively weigh order, change, trust and responsibility, and " +
        "it shapes which policy promises will actually feel right to you."
      );
    }

    /* Paragraph 3 — why the top party matched. */
    const aligned = results.priorities.filter(p =>
      Math.abs(p.score) >= CONFIG.scoring.moderateAxisThreshold &&
      (best.party.vector[p.axis] || 0) * p.score > 0);
    const alignedNames = aligned.map(p => CONFIG.axes[p.axis].name.toLowerCase());
    paragraphs.push(
      "Your best match is the " + best.party.name + " at " + best.percent +
      "%, because it " + best.party.matchReason + "." +
      (alignedNames.length
        ? " The overlap is concentrated exactly where your convictions are " +
          "strongest — " + alignedNames.join(", ") + " — which is why the " +
          "similarity score is difficult to dislodge."
        : "") +
      " Its credibility weight of " + best.party.credibility.toFixed(2) +
      " (the model's estimate of how free a party is from lobby capture " +
      "and broken promises) is applied after the similarity comparison, so " +
      "this match survives the adjustment intact."
    );

    /* Paragraph 4 — why the runners-up fell short. */
    [matches[1], matches[2]].forEach(match => {
      if (!match) return;
      // The axis gaps that cost this party the most, weighted by how much
      // the user actually cares about the axis.
      const gaps = Engine.AXES
        .map(axis => ({
          axis,
          gap: Math.abs((results.profile.scores[axis] || 0) - (match.party.vector[axis] || 0)) *
               Math.abs(results.profile.scores[axis] || 0)
        }))
        .sort((a, b) => b.gap - a.gap)
        .slice(0, 2);
      const gapText = gaps.map(g => {
        const lean = axisLean(g.axis, results.profile.scores[g.axis]);
        return lean.name.toLowerCase() + " (you: " + lean.pole + ")";
      }).join(" and ");
      const credNote = match.party.credibility < best.party.credibility
        ? " Its lower credibility weight (" + match.party.credibility.toFixed(2) +
          " against the " + best.party.name + "'s " + best.party.credibility.toFixed(2) +
          ") widens the gap further."
        : "";
      paragraphs.push(
        "The " + match.party.name + " came " +
        (match === matches[1] ? "second" : "third") + " at " + match.percent +
        "%. It " + match.party.mismatchReason + ". Against your profile " +
        "specifically, it loses most ground on " + gapText + "." + credNote
      );
    });

    /* Paragraph 5 — the paper's axis-combination templates that fired. */
    results.templates.forEach(rule => paragraphs.push(rule.text));

    /* Paragraph 6 — contradictions, woven in as guidance. */
    results.contradictions.forEach(rule => paragraphs.push(rule.text));

    /* Paragraph 7 — what stayed uncertain, and how to read the result. */
    const uncertainNames = results.uncertain.map(code => CONFIG.axes[code].name.toLowerCase());
    paragraphs.push(
      (uncertainNames.length
        ? "Some dimensions never settled: your answers left " +
          uncertainNames.join(", ") + " close to neutral. A different mood " +
          "on a different day could move these, and with them the finer " +
          "ordering of your matches. "
        : "Notably, almost every dimension the assessment measures came " +
          "back with a clear signal, which makes your profile unusually " +
          "well-defined. ") +
      "Overall confidence in this result is " + results.confidence + "%, " +
      "reflecting how decisively you answered, how cleanly your values fit " +
      "together, and how far the winner finished ahead of the field. Treat " +
      "the percentages as a map of your priorities, not a verdict — the " +
      "most useful question to take away is whether the trade-offs " +
      "described above are the ones you would actually choose."
    );

    paragraphs.forEach(text => holder.appendChild(el("p", null, text)));
  }

  /* ---------- most influential answers ---------- */

  function renderInfluences(results) {
    const holder = $("influences");
    holder.innerHTML = "";
    results.influences.forEach(row => {
      const div = el("div", "influence-row");
      const direction = row.influence >= 0
        ? "pulled you towards the " + results.best.party.name
        : "pushed you away from the " + results.best.party.name;
      div.innerHTML =
        '<p class="influence-q">“' + esc(row.question.text) + "”</p>" +
        '<p class="influence-meta">Your answer: ' + esc(row.answerLabel) +
        " — " + esc(direction) + "</p>";
      holder.appendChild(div);
    });
  }

  /* ---------- uncertain values ---------- */

  function renderUncertain(results) {
    const holder = $("uncertain");
    holder.innerHTML = "";
    if (!results.uncertain.length) {
      holder.appendChild(el("p", "item-text",
        "None — every dimension received a clear signal from your answers."));
      return;
    }
    const tags = el("div", "tag-list");
    results.uncertain.forEach(code => {
      tags.appendChild(el("span", "tag faint", CONFIG.axes[code].name));
    });
    holder.appendChild(tags);
    holder.appendChild(el("p", "item-text",
      "These values stayed close to neutral — either your answers pulled " +
      "in both directions, or the questions touching them didn't move you. " +
      "They contributed little to your match."));
  }

  /* =====================================================================
     BOOT
     ===================================================================== */

  function startQuestions() {
    showScreen("question");
    renderQuestion(null);
  }

  function init() {
    screens.intro = $("screen-intro");
    screens.question = $("screen-question");
    screens.results = $("screen-results");

    const hasProgress = loadState();
    renderIntro(hasProgress);

    $("btn-start").addEventListener("click", startQuestions);

    $("btn-resume").addEventListener("click", () => {
      // A finished session resumes straight into the results dashboard.
      if (state.finished) { finish(); return; }
      startQuestions();
    });

    $("btn-restart").addEventListener("click", () => {
      clearState();
      saveState();
      startQuestions();
    });

    $("btn-back").addEventListener("click", goBack);
    $("btn-next").addEventListener("click", goNext);
    $("btn-retake").addEventListener("click", () => {
      clearState();
      renderIntro(false);
      showScreen("intro");
    });

    document.addEventListener("keydown", onKeyDown);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
