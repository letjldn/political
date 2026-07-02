/* ==========================================================================
   ENGINE.JS — THE SCORING MODEL
   ==========================================================================

   This file implements every mathematical step described in the design
   paper, and nothing else. It contains NO question text, NO party numbers
   and NO explanation prose — all of that lives in config.js. It also has
   no knowledge of the DOM, which makes it easy to unit-test from a console.

   The pipeline (Engine.computeResults) is:

     1. convertAnswerValue()   — 7-point answer → value in [-1, +1]
                                 using  v = (answer - 4) / 3
     2. buildAxisProfile()     — accumulate value × weight into each hidden
                                 axis, then normalise each axis by the sum of
                                 absolute weights that touched it (paper:
                                 "each axis score is normalized by the sum of
                                 absolute weights to keep them in range")
     3. cosineSimilarity()     — compare the user's axis profile with each
                                 party vector
     4. credibility adjustment — multiply the similarity by the party's
                                 credibility weight (the paper's "capture"
                                 penalty for lobby-prone parties)
     5. rank parties, compute match percentages and the confidence score
     6. detect contradictions (config rules + generic user-vs-party tensions)
     7. compute per-answer influence on the top match, uncertain axes, top
        priorities, fired explanation templates and psychological traits

   Everything here is deterministic and runs instantly in the browser.
   ========================================================================== */

"use strict";

const Engine = (() => {

  /* The canonical list of axis codes, taken from CONFIG so that adding an
     axis in config.js automatically flows through the whole engine. */
  const AXES = Object.keys(CONFIG.axes);

  /* ---------------------------------------------------------------
     STEP 1 — ANSWER VALUE CONVERSION
     The paper's formula for the 7-point scale:

         value = (answer - 4) / 3

     giving  Strongly disagree (1) → -1 … Neutral (4) → 0 …
     Strongly agree (7) → +1.
     --------------------------------------------------------------- */
  function convertAnswerValue(answer) {
    return (answer - CONFIG.scoring.scaleMidpoint) / CONFIG.scoring.scaleDivisor;
  }

  /* ---------------------------------------------------------------
     Rank-position → value conversion for drag-to-rank questions.
     The paper defines ranking questions but not their numeric model,
     so we use the natural linear extension of the likert scale:
     the item ranked 1st scores +1, the last scores -1, and the rest
     are evenly spaced between. With 5 items: +1, +0.5, 0, -0.5, -1.
     --------------------------------------------------------------- */
  function rankPositionValue(position, itemCount) {
    if (itemCount <= 1) return 0;
    return 1 - (2 * position) / (itemCount - 1); // position is 0-based
  }

  /* ---------------------------------------------------------------
     STEP 2 — BUILD THE USER'S HIDDEN AXIS PROFILE

     `answers` maps question id → answer record:
        likert:            { answer: 1..7 }
        choice / scenario: { optionIndex: 0.. }
        rank:              { order: [itemId, itemId, ...] } top-first

     For every (value, weights) contribution we do exactly what the
     paper specifies:   user[axis] += value * weight
     while also accumulating |weight| per axis for the normalisation
     denominator. Returns:
        raw        – un-normalised sums
        totals     – sum of |weight| per axis (the denominators)
        scores     – normalised scores in [-1, +1]
        valueMagnitudes – list of |value| for every scored contribution
                          (used for the confidence "decisiveness" term)
     --------------------------------------------------------------- */
  function buildAxisProfile(answers) {
    const raw = {}, totals = {};
    AXES.forEach(a => { raw[a] = 0; totals[a] = 0; });
    const valueMagnitudes = [];

    // Helper applying one contribution: user[axis] += value * weight.
    function apply(value, weights) {
      for (const axis in weights) {
        if (!(axis in raw)) continue;       // ignore unknown axis codes
        raw[axis] += value * weights[axis];
        totals[axis] += Math.abs(weights[axis]);
      }
    }

    for (const question of CONFIG.questions) {
      const record = answers[question.id];
      if (!record) continue; // unanswered questions contribute nothing

      if (question.type === "likert") {
        const v = convertAnswerValue(record.answer);
        valueMagnitudes.push(Math.abs(v));
        apply(v, question.weights);

      } else if (question.type === "choice" || question.type === "scenario") {
        // The chosen option's weights are applied at full strength (v = +1):
        // choosing an option is a definite statement, and each option's
        // direction/intensity is encoded in its own weight signs/sizes.
        const option = question.options[record.optionIndex];
        if (!option) continue;
        valueMagnitudes.push(1);
        apply(1, option.weights);

      } else if (question.type === "rank") {
        // Each item contributes with a value determined by its rank position.
        const order = record.order;
        order.forEach((itemId, position) => {
          const item = question.items.find(it => it.id === itemId);
          if (!item) return;
          const v = rankPositionValue(position, order.length);
          valueMagnitudes.push(Math.abs(v));
          apply(v, item.weights);
        });
      }
    }

    // Normalise: axis score = raw sum / sum of absolute weights, keeping
    // every axis inside [-1, +1] exactly as the paper prescribes.
    const scores = {};
    AXES.forEach(a => { scores[a] = totals[a] > 0 ? raw[a] / totals[a] : 0; });

    return { raw, totals, scores, valueMagnitudes };
  }

  /* ---------------------------------------------------------------
     STEP 3 — COSINE SIMILARITY between the user's axis profile and a
     party vector, over the full axis space:

         cos(u, p) = (u · p) / (|u| · |p|)

     Returns 0 when either vector is all-zero (no information).
     --------------------------------------------------------------- */
  function cosineSimilarity(userScores, partyVector) {
    let dot = 0, magU = 0, magP = 0;
    for (const axis of AXES) {
      const u = userScores[axis] || 0;
      const p = partyVector[axis] || 0;
      dot += u * p;
      magU += u * u;
      magP += p * p;
    }
    if (magU === 0 || magP === 0) return 0;
    return dot / (Math.sqrt(magU) * Math.sqrt(magP));
  }

  /* ---------------------------------------------------------------
     STEPS 4–5 — PARTY MATCHING WITH CREDIBILITY ADJUSTMENT

     The paper: "The cosine scores are adjusted by a credibility weight
     (penalizing parties more prone to lobbies or dishonesty). The final
     highest score is the best match."

     Cosine similarity lives in [-1, +1]. Multiplying a *negative*
     cosine directly by a credibility factor < 1 would perversely
     REWARD low-credibility parties (making a bad match less bad), so
     before applying the credibility multiplier we map the cosine onto
     [0, 1] with (cos + 1) / 2 — a monotonic rescaling that preserves
     the ranking of the raw cosines while making the credibility
     multiplier a pure penalty, exactly as the paper intends:

         adjusted = ((cos + 1) / 2) × credibility

     The displayed match percentage is adjusted × 100.
     --------------------------------------------------------------- */
  function matchParties(userScores) {
    const matches = CONFIG.parties.map(party => {
      const cosine = cosineSimilarity(userScores, party.vector);
      const normalisedSimilarity = (cosine + 1) / 2;      // → [0, 1]
      const adjusted = normalisedSimilarity * party.credibility;
      return {
        party,
        cosine,                       // raw cosine, kept for transparency
        adjusted,                     // credibility-adjusted score (ranking key)
        percent: Math.round(adjusted * 100)
      };
    });
    matches.sort((a, b) => b.adjusted - a.adjusted);
    return matches;
  }

  /* ---------------------------------------------------------------
     CONFIDENCE SCORE (0–100)

     confidence = 100 × ( wSep × separation
                        + wDec × decisiveness
                        + wCon × consistency )

     separation   – how clearly the winner beat the runner-up:
                    gap between the top two adjusted scores divided by
                    `separationFullGap` (capped at 1).
     decisiveness – mean |answer value|: a user who sat on "Neutral"
                    for most questions gives the model little signal.
     consistency  – 1 − penalty × (number of detected contradictions),
                    floored at 0.
     All three terms and their weights are set in CONFIG.scoring.
     --------------------------------------------------------------- */
  function computeConfidence(matches, valueMagnitudes, contradictionCount) {
    const c = CONFIG.scoring.confidence;

    const gap = matches.length > 1 ? matches[0].adjusted - matches[1].adjusted : 1;
    const separation = Math.min(1, Math.max(0, gap / c.separationFullGap));

    const decisiveness = valueMagnitudes.length
      ? valueMagnitudes.reduce((s, v) => s + v, 0) / valueMagnitudes.length
      : 0;

    const consistency = Math.max(0, 1 - c.contradictionPenalty * contradictionCount);

    const score =
      c.weightSeparation * separation +
      c.weightDecisiveness * decisiveness +
      c.weightConsistency * consistency;

    return Math.round(100 * Math.min(1, Math.max(0, score)));
  }

  /* ---------------------------------------------------------------
     CONDITION EVALUATION for templates and contradiction rules.
     A condition is { axis, min } (score >= min) or { axis, max }
     (score <= max). A rule fires when every entry in `all` holds and,
     if `any` is present, at least one of its entries holds.
     --------------------------------------------------------------- */
  function conditionHolds(cond, scores) {
    const s = scores[cond.axis] || 0;
    if ("min" in cond && s < cond.min) return false;
    if ("max" in cond && s > cond.max) return false;
    return true;
  }

  function ruleFires(rule, scores) {
    if (rule.all && !rule.all.every(c => conditionHolds(c, scores))) return false;
    if (rule.any && !rule.any.some(c => conditionHolds(c, scores))) return false;
    return true;
  }

  /* ---------------------------------------------------------------
     STEP 6a — CONFIG-DEFINED CONTRADICTIONS (the paper's rules).
     Some rules additionally require the winning party to be in a
     given set (e.g. the anti-corruption / establishment-match rule).
     --------------------------------------------------------------- */
  function detectContradictions(scores, topPartyId) {
    return CONFIG.contradictions.filter(rule => {
      if (!ruleFires(rule, scores)) return false;
      if (rule.topMatchIn && !rule.topMatchIn.includes(topPartyId)) return false;
      return true;
    });
  }

  /* ---------------------------------------------------------------
     STEP 6b — GENERIC USER-vs-PARTY TENSIONS
     The paper: "If any axis is strongly contradictory to the chosen
     party, we note it." An axis is a tension when the user's score
     and the party's position both exceed their thresholds and point
     in opposite directions. Returns tensions sorted by severity
     (|user| × |party|).
     --------------------------------------------------------------- */
  function detectTensions(scores, party) {
    const t = CONFIG.scoring;
    const tensions = [];
    for (const axis of AXES) {
      const u = scores[axis] || 0;
      const p = party.vector[axis] || 0;
      if (Math.abs(u) >= t.tensionUserThreshold &&
          Math.abs(p) >= t.tensionPartyThreshold &&
          u * p < 0) {
        tensions.push({ axis, userScore: u, partyScore: p, severity: Math.abs(u * p) });
      }
    }
    tensions.sort((a, b) => b.severity - a.severity);
    return tensions;
  }

  /* ---------------------------------------------------------------
     STEP 7a — TOP PRIORITIES
     The paper: "We list the user's top 5 axes (highest absolute
     scores) to describe their priorities."
     --------------------------------------------------------------- */
  function topAxes(scores, count) {
    return AXES
      .map(axis => ({ axis, score: scores[axis] }))
      .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
      .slice(0, count);
  }

  /* ---------------------------------------------------------------
     STEP 7b — UNCERTAIN AXES
     Axes whose normalised score stayed near zero — either because the
     user answered near "Neutral" on them or because their answers
     pulled in both directions — are reported as "remained uncertain".
     Axes that no answered question touched at all are also included.
     --------------------------------------------------------------- */
  function uncertainAxes(profile) {
    return AXES.filter(axis =>
      profile.totals[axis] === 0 ||
      Math.abs(profile.scores[axis]) < CONFIG.scoring.uncertainAxisThreshold
    );
  }

  /* ---------------------------------------------------------------
     STEP 7c — MOST INFLUENTIAL ANSWERS
     For transparency we measure how much each answer pushed the user
     towards (or away from) the winning party. An answer's influence
     is its contribution to the user-party dot product, using the
     party's unit vector:

        influence(q) = Σ_axis  value × weight(q, axis) × p̂(axis)

     where p̂ is the party vector divided by its magnitude. Positive
     influence pulled the user towards the winner; negative pushed
     away. We return the largest |influence| answers.
     --------------------------------------------------------------- */
  function influentialAnswers(answers, party, count) {
    // Build the party's unit vector once.
    let mag = 0;
    AXES.forEach(a => { const p = party.vector[a] || 0; mag += p * p; });
    mag = Math.sqrt(mag) || 1;

    // Collect every scored contribution per question, mirroring
    // buildAxisProfile()'s handling of each question type.
    const rows = [];
    for (const question of CONFIG.questions) {
      const record = answers[question.id];
      if (!record) continue;

      // (value, weights, answerLabel) triples for this question
      const parts = [];
      let answerLabel = "";

      if (question.type === "likert") {
        const v = convertAnswerValue(record.answer);
        parts.push({ v, weights: question.weights });
        answerLabel = CONFIG.ui.likertLabels[record.answer - 1];

      } else if (question.type === "choice" || question.type === "scenario") {
        const option = question.options[record.optionIndex];
        if (!option) continue;
        parts.push({ v: 1, weights: option.weights });
        answerLabel = option.label;

      } else if (question.type === "rank") {
        record.order.forEach((itemId, position) => {
          const item = question.items.find(it => it.id === itemId);
          if (!item) return;
          parts.push({ v: rankPositionValue(position, record.order.length), weights: item.weights });
        });
        const topItem = question.items.find(it => it.id === record.order[0]);
        answerLabel = "Ranked “" + (topItem ? topItem.label : "?") + "” highest";
      }

      let influence = 0;
      for (const part of parts) {
        for (const axis in part.weights) {
          influence += part.v * part.weights[axis] * ((party.vector[axis] || 0) / mag);
        }
      }
      rows.push({ question, answerLabel, influence });
    }

    rows.sort((a, b) => Math.abs(b.influence) - Math.abs(a.influence));
    return rows.slice(0, count);
  }

  /* ---------------------------------------------------------------
     STEP 7d — HIDDEN PSYCHOLOGICAL PROFILE
     Each trait in CONFIG.psychology blends axis scores:

         trait = Σ (score[axis] × weight)  /  Σ |weight|

     keeping the trait in [-1, +1]. The trait's descriptive text is
     picked by which third of the range the score falls into.
     --------------------------------------------------------------- */
  function psychologicalProfile(scores) {
    return CONFIG.psychology.map(trait => {
      let sum = 0, totalWeight = 0;
      for (const axis in trait.formula) {
        sum += (scores[axis] || 0) * trait.formula[axis];
        totalWeight += Math.abs(trait.formula[axis]);
      }
      const value = totalWeight > 0 ? sum / totalWeight : 0;
      const band = value >= 0.2 ? "high" : value <= -0.2 ? "low" : "mid";
      const text = band === "high" ? trait.highText
                 : band === "low" ? trait.lowText
                 : trait.midText;
      return { trait, value, band, text };
    });
  }

  /* ---------------------------------------------------------------
     STEP 7e — FIRED EXPLANATION TEMPLATES (paper section
     "Specific templates based on top axes").
     --------------------------------------------------------------- */
  function firedTemplates(scores) {
    return CONFIG.templates.filter(rule => ruleFires(rule, scores));
  }

  /* ---------------------------------------------------------------
     THE FULL PIPELINE — returns one results object the UI renders.
     --------------------------------------------------------------- */
  function computeResults(answers) {
    const profile = buildAxisProfile(answers);
    const matches = matchParties(profile.scores);
    const best = matches[0];

    const contradictions = detectContradictions(profile.scores, best.party.id);
    const tensions = detectTensions(profile.scores, best.party);
    const priorities = topAxes(profile.scores, CONFIG.scoring.topAxisCount);
    const uncertain = uncertainAxes(profile);
    const influences = influentialAnswers(answers, best.party,
                                          CONFIG.scoring.influentialAnswerCount);
    const psychology = psychologicalProfile(profile.scores);
    const templates = firedTemplates(profile.scores);

    // Contradictions AND severe tensions both reduce consistency-based
    // confidence — an inconsistent profile is a less certain match.
    const confidence = computeConfidence(
      matches, profile.valueMagnitudes, contradictions.length + tensions.length
    );

    return {
      profile,          // { raw, totals, scores, valueMagnitudes }
      matches,          // ranked [{ party, cosine, adjusted, percent }]
      best,             // matches[0]
      confidence,       // 0–100
      priorities,       // top-N axes with signed scores
      uncertain,        // axis codes that stayed near zero
      contradictions,   // fired config contradiction rules
      tensions,         // generic user-vs-party axis conflicts
      influences,       // most influential answers for the top match
      psychology,       // hidden psychological trait read-outs
      templates         // fired explanation templates
    };
  }

  /* Public API — computeResults is what the app uses; the individual
     steps are exposed too so the model can be inspected or tested
     from the browser console (e.g. Engine.cosineSimilarity(...)). */
  return {
    AXES,
    convertAnswerValue,
    rankPositionValue,
    buildAxisProfile,
    cosineSimilarity,
    matchParties,
    computeConfidence,
    detectContradictions,
    detectTensions,
    topAxes,
    uncertainAxes,
    influentialAnswers,
    psychologicalProfile,
    firedTemplates,
    computeResults
  };
})();
