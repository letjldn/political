/* ==========================================================================
   CONFIG.JS — THE SINGLE SOURCE OF TRUTH FOR ALL CONTENT AND CALIBRATION
   ==========================================================================

   This file contains EVERYTHING that a maintainer might want to edit:

     1. CONFIG.ui              — every piece of visible text (titles, labels,
                                 button text, disclaimer).
     2. CONFIG.scoring         — every numeric constant used by the engine
                                 (scale conversion, thresholds, confidence
                                 weights). Change the maths calibration here.
     3. CONFIG.axes            — the hidden ideological axes. The design paper
                                 says "16 dimensions" but actually lists 17
                                 named axes (ECO, FIS, AUT, PRI, CUL, IMM, NAT,
                                 FOR, ENV, HOU, WSF, COR, DEM, TEC, REL, EQ,
                                 TRU). We implement every axis the paper
                                 defines, so there are 17 entries here.
     4. CONFIG.questions       — all questions. The 125 agree/disagree
                                 questions are copied VERBATIM from the design
                                 paper, in the paper's order and grouping.
                                 After them come the ranking question that the
                                 paper suggests in its closing note, plus a
                                 small number of multiple-choice and scenario
                                 items that exercise the other question types
                                 the site must support. Add, remove or reweight
                                 questions here — the engine adapts
                                 automatically.
     5. CONFIG.parties         — the 8 party profiles (4 left → 4 right) with
                                 full 17-axis vectors and credibility weights,
                                 exactly as described in the paper.
     6. CONFIG.templates       — the "specific templates based on top axes"
                                 from the paper's Explanation section.
     7. CONFIG.contradictions  — the contradiction-detection rules from the
                                 paper's "Contradiction insights" section.
     8. CONFIG.psychology      — the hidden psychological profile traits shown
                                 on the results dashboard, each derived from a
                                 weighted blend of axis scores.

   NOTHING in the application logic (engine.js / app.js) contains question
   text, weights, party numbers or explanation prose. To expand or recalibrate
   the questionnaire you should only ever need to edit this file.

   HOW QUESTION WEIGHTS WORK (from the design paper):
   ---------------------------------------------------
   Every 7-point answer is converted to a value v in [-1, +1]:

        v = (answer - 4) / 3        e.g. "Agree" (6) → 0.67, "Neutral" (4) → 0

   Each question carries a map of axis weights, e.g. Q1:
        { EQ: +1, COR: +0.5, ECO: +1 }
   meaning agreement with Q1 pushes the user towards Equality (weight 1),
   Anti-corruption (weight 0.5) and pro-public Economics (weight 1):

        user.EQ  += v * 1.0;
        user.COR += v * 0.5;
        user.ECO += v * 1.0;

   After all questions, each axis is normalised by the sum of the absolute
   weights that touched it, keeping every axis score inside [-1, +1].

   A POSITIVE weight means agreement pushes towards the "+" pole of the axis
   as defined in CONFIG.axes; a NEGATIVE weight means agreement pushes towards
   the "-" pole.
   ========================================================================== */

"use strict";

const CONFIG = {

  /* ------------------------------------------------------------------
     1. USER-VISIBLE TEXT
     The quiz must feel like a psychological assessment, never a
     political quiz — so no visible text mentions parties, left/right,
     or politics while the user is answering.
     ------------------------------------------------------------------ */
  ui: {
    siteTitle: "Values & Priorities Assessment",
    introHeading: "Values & Priorities Assessment",
    introText: [
      "This assessment explores what you genuinely value and how you weigh " +
      "difficult trade-offs. It is not a test of knowledge and it has no " +
      "right or wrong answers.",
      "Think about what you truly believe. There are no “right” or " +
      "“wrong” answers—only what matters most to you. Try to " +
      "imagine how policy would really affect things you care about.",
      "Statements appear one at a time. Answer instinctively; your first " +
      "reaction is usually the most honest one. Your progress is saved " +
      "automatically on this device, so you can leave and come back."
    ],
    startButton: "Begin assessment",
    resumeButton: "Continue where you left off",
    restartButton: "Start again from the beginning",
    backButton: "Back",
    nextButton: "Next",
    finishButton: "See your profile",
    questionCounter: "Question {current} of {total}",   // {current}/{total} replaced at runtime
    keyboardHint: "Keyboard: 1–7 to answer · ← back · → next",
    likertLabels: [
      "Strongly disagree",   // 1
      "Disagree",            // 2
      "Slightly disagree",   // 3
      "Neutral / unsure",    // 4
      "Slightly agree",      // 5
      "Agree",               // 6
      "Strongly agree"       // 7
    ],
    rankHint: "Drag to reorder (or use the arrow buttons). Put what matters most at the top.",
    resultsHeading: "Your results",
    analysisHeading: "Written analysis",
    // Final disclaimer — quoted verbatim from the design paper.
    disclaimer:
      "This result is a data-driven suggestion based on your answers. It is " +
      "not an official voting recommendation. Only you can decide which " +
      "party you truly align with."
  },

  /* ------------------------------------------------------------------
     2. SCORING CONSTANTS — every number the engine uses lives here so
        the model can be recalibrated without touching engine code.
     ------------------------------------------------------------------ */
  scoring: {
    // 7-point scale conversion: value = (answer - midpoint) / divisor
    scaleMidpoint: 4,
    scaleDivisor: 3,

    // An axis counts as "strong" (a priority) above this absolute score.
    strongAxisThreshold: 0.35,
    // An axis counts as "moderate" above this absolute score.
    moderateAxisThreshold: 0.18,
    // An axis with |score| below this is reported as "remained uncertain".
    uncertainAxisThreshold: 0.12,
    // Number of top axes listed as the user's priorities (the paper: top 5).
    topAxisCount: 5,

    // A user-vs-party disagreement on one axis counts as a "tension" when
    // both |user score| and |party position| exceed these and signs differ.
    tensionUserThreshold: 0.30,
    tensionPartyThreshold: 0.40,

    // Confidence score = 100 * (wSep*separation + wDec*decisiveness + wCon*consistency)
    //   separation   – gap between the top two credibility-adjusted matches,
    //                  scaled so a gap of `separationFullGap` = 1.0
    //   decisiveness – mean |answer value|: how far from "Neutral" the user sat
    //   consistency  – 1 minus a penalty per detected contradiction
    confidence: {
      weightSeparation: 0.40,
      weightDecisiveness: 0.30,
      weightConsistency: 0.30,
      separationFullGap: 0.08,
      contradictionPenalty: 0.25   // each contradiction removes 25% of the consistency term
    },

    // Number of "most influential answers" shown on the dashboard.
    influentialAnswerCount: 6,

    // How many runner-up parties to show (paper: best + next three = top 4).
    topPartyCount: 4
  },

  /* ------------------------------------------------------------------
     3. HIDDEN AXES — verbatim definitions from the design paper.
        `positive`/`negative` describe each pole; `explanation` is the
        interactive text shown when a user taps the axis on the results
        dashboard. Never shown during the questionnaire itself.
     ------------------------------------------------------------------ */
  axes: {
    ECO: {
      name: "Economic system",
      positive: "Pro-government intervention and redistribution",
      negative: "Free market, low-tax capitalism",
      explanation:
        "This axis measures how you want the economy to be run. High scores " +
        "favour public ownership, redistribution and state intervention; low " +
        "scores favour free markets, low taxes and private enterprise."
    },
    FIS: {
      name: "Fiscal activism",
      positive: "Big public investment",
      negative: "Balanced budgets and austerity",
      explanation:
        "This axis captures your appetite for public spending. High scores " +
        "back large public investment even at the cost of debt or taxes; low " +
        "scores prioritise balanced budgets and restraint."
    },
    AUT: {
      name: "Authority",
      positive: "Strong authority, laws and order",
      negative: "Personal autonomy and minimal coercion",
      explanation:
        "This axis measures how much order you want the state to impose. " +
        "High scores prefer strong policing, tough sentencing and firm rules; " +
        "low scores prefer personal autonomy and minimal coercion."
    },
    PRI: {
      name: "Privacy & civil liberties",
      positive: "Pro personal privacy",
      negative: "Pro government surveillance",
      explanation:
        "This axis tracks the balance you strike between privacy and " +
        "security. High scores defend encryption, protest rights and " +
        "personal data; low scores accept surveillance in exchange for safety."
    },
    CUL: {
      name: "Social progressivism",
      positive: "Progressive / liberal social values",
      negative: "Traditional / conservative social values",
      explanation:
        "This axis measures your social values. High scores embrace social " +
        "change, diversity and individual lifestyle freedom; low scores " +
        "value tradition, family structure and continuity."
    },
    IMM: {
      name: "Immigration stance",
      positive: "Open immigration and internationalism",
      negative: "Restrictive, identity-based immigration policy",
      explanation:
        "This axis captures your instinct on migration. High scores welcome " +
        "openness and integration; low scores prefer tight controls and " +
        "prioritising the existing community."
    },
    NAT: {
      name: "Nationalism",
      positive: "Strong national sovereignty and culture",
      negative: "Weaker emphasis on national identity",
      explanation:
        "This axis measures how central the nation is to your worldview. " +
        "High scores put sovereignty, borders and national culture first; " +
        "low scores see national identity as less important than other goals."
    },
    FOR: {
      name: "Internationalism",
      positive: "Pro global cooperation (EU / UN / trade)",
      negative: "Isolationism",
      explanation:
        "This axis tracks your view of the outside world. High scores favour " +
        "alliances, trade pacts and international law; low scores prefer " +
        "self-reliance and independence from global bodies."
    },
    ENV: {
      name: "Environment priority",
      positive: "Environment and climate above growth",
      negative: "Economy and industry above climate",
      explanation:
        "This axis measures the price you will pay for the environment. High " +
        "scores accept costs and slower growth to protect climate and " +
        "nature; low scores put jobs, bills and industry first."
    },
    HOU: {
      name: "Housing",
      positive: "Housing as a right (state intervention)",
      negative: "Free-market housing",
      explanation:
        "This axis captures your view of housing. High scores treat housing " +
        "as a right needing rent controls, social building and tenant " +
        "protection; low scores trust the market and property ownership."
    },
    WSF: {
      name: "Women's safety & family welfare",
      positive: "Strong focus on violence against women and family welfare",
      negative: "Treating those as lower, separate priorities",
      explanation:
        "This axis measures how much weight you give to practical safety and " +
        "family support — refuges, childcare, parental leave, child " +
        "poverty — as first-order political priorities."
    },
    COR: {
      name: "Anti-corruption",
      positive: "Anti-establishment, anti-lobby",
      negative: "Establishment-friendly",
      explanation:
        "This axis measures how worried you are about money and influence in " +
        "politics. High scores demand transparency, donation limits and " +
        "accountability; low scores are relaxed about the status quo."
    },
    DEM: {
      name: "Democracy reform",
      positive: "Pro electoral and devolution reform",
      negative: "Constitutional status quo",
      explanation:
        "This axis tracks appetite for changing how Britain is governed — " +
        "proportional representation, elected Lords, devolution, referendums. " +
        "High scores want reform; low scores prefer the current system."
    },
    TEC: {
      name: "Technology control",
      positive: "Pro government control / regulation of tech",
      negative: "Laissez-faire technology growth",
      explanation:
        "This axis measures how you want technology governed. High scores " +
        "want AI, platforms and data tightly regulated; low scores want " +
        "innovation left to run with minimal interference."
    },
    REL: {
      name: "Religion in law",
      positive: "Religion should influence policy",
      negative: "Secular law-making",
      explanation:
        "This axis measures the role you give faith in public life. High " +
        "scores support faith schools and morally guided law-making; low " +
        "scores want law kept strictly secular."
    },
    EQ: {
      name: "Equality",
      positive: "Egalitarian, pro-redistribution",
      negative: "Acceptance of hierarchy",
      explanation:
        "This axis measures your instinct about fairness. High scores see " +
        "unequal outcomes as a problem for society to fix; low scores accept " +
        "hierarchy and difference as natural or earned."
    },
    TRU: {
      name: "Trust in institutions",
      positive: "High trust in experts, media and politicians",
      negative: "Scepticism and cynicism about institutions",
      explanation:
        "This axis measures your baseline trust in the people who run " +
        "things — experts, courts, media, government. High scores extend " +
        "trust; low scores assume institutions serve themselves."
    }
  },

  /* ------------------------------------------------------------------
     4. QUESTIONS
     ------------------------------------------------------------------
     Types supported by the engine:

       "likert"   — 7-point agree/disagree statement (the paper's core
                    format). Fields: text, weights.
       "rank"     — drag-to-rank list. Each item has its own axis
                    weights; the item ranked top scores +1, the bottom
                    scores -1, evenly spaced between (see engine.js).
       "choice"   — single multiple-choice question. Each option has its
                    own axis weights, applied at full strength (v = +1).
       "scenario" — a short situation with a choice of responses; scored
                    identically to "choice" but rendered with the
                    situation text above the options.

     `category` is internal only (used for organisation and for the
     results analysis) and is never shown while answering.

     Questions 1–125 are copied VERBATIM from the design paper.
     ------------------------------------------------------------------ */
  questions: [

    /* ============ Economy & Work (Questions 1–15) ============ */
    {
      id: 1, category: "Economy & Work", type: "likert",
      text: "The government should tax the rich more to fund better services for everyone.",
      // Weight example given explicitly in the paper: { EQ:+1, COR:+0.5, ECO:+1 }
      weights: { EQ: 1, COR: 0.5, ECO: 1 }
    },
    {
      id: 2, category: "Economy & Work", type: "likert",
      text: "It’s fair for someone who did badly in life (due to health, upbringing, etc.) to receive more financial support.",
      weights: { EQ: 1, ECO: 0.6 }
    },
    {
      id: 3, category: "Economy & Work", type: "likert",
      text: "Key industries (energy, transport, water, etc.) should be owned by the public or workers, not private companies.",
      weights: { ECO: 1, EQ: 0.7, COR: 0.3 }
    },
    {
      id: 4, category: "Economy & Work", type: "likert",
      text: "Everyone deserves a guaranteed living wage, even if it means fewer jobs for low-skilled workers.",
      weights: { EQ: 0.8, ECO: 0.7 }
    },
    {
      id: 5, category: "Economy & Work", type: "likert",
      text: "In general, more government investment spurs growth better than lower taxes for big companies.",
      weights: { ECO: 0.9, FIS: 0.8 }
    },
    {
      id: 6, category: "Economy & Work", type: "likert",
      text: "We must cut government debt, even if it means cutting some public services (like library or park budgets).",
      weights: { FIS: -1, ECO: -0.5 }
    },
    {
      id: 7, category: "Economy & Work", type: "likert",
      text: "Businesses should face strict rules (e.g. on pollution, employment standards) even if it raises prices.",
      weights: { ECO: 0.7, ENV: 0.4, TEC: 0.3 }
    },
    {
      id: 8, category: "Economy & Work", type: "likert",
      text: "Free trade deals help ordinary people by lowering prices, even if they hurt some local industries.",
      weights: { FOR: 0.8, ECO: -0.4, NAT: -0.3 }
    },
    {
      id: 9, category: "Economy & Work", type: "likert",
      text: "The government should do more to help small businesses and entrepreneurs, even if large corporations pay less tax.",
      weights: { COR: 0.4, ECO: -0.3, EQ: 0.2 }
    },
    {
      id: 10, category: "Economy & Work", type: "likert",
      text: "The state should guarantee good pensions for all older people, funded by taxes on today’s workers.",
      weights: { FIS: 0.7, EQ: 0.6, ECO: 0.5 }
    },
    {
      id: 11, category: "Economy & Work", type: "likert",
      text: "Workers should have more say (e.g. on company boards or unions) to share the wealth they create.",
      weights: { ECO: 0.9, EQ: 0.8, COR: 0.4 }
    },
    {
      id: 12, category: "Economy & Work", type: "likert",
      text: "Keeping prices stable (low inflation) is more important than ensuring full employment.",
      weights: { ECO: -0.6, FIS: -0.7 }
    },
    {
      id: 13, category: "Economy & Work", type: "likert",
      text: "To make housing cheaper, the government should allow more new homes to be built, even in protected greenbelt areas.",
      weights: { HOU: 0.8, ENV: -0.5 }
    },
    {
      id: 14, category: "Economy & Work", type: "likert",
      text: "Rent controls and stronger tenant rights are necessary for a fair housing market.",
      weights: { HOU: 1, ECO: 0.6, EQ: 0.5 }
    },
    {
      id: 15, category: "Economy & Work", type: "likert",
      text: "Home ownership should be encouraged (through policies like right-to-buy or shared ownership).",
      weights: { HOU: -0.4, ECO: -0.4 }
    },

    /* ============ Health & Welfare (16–25) ============ */
    {
      id: 16, category: "Health & Welfare", type: "likert",
      text: "The NHS should remain fully public; we shouldn’t rely more on private companies or insurance for healthcare.",
      weights: { ECO: 1, EQ: 0.6, FIS: 0.5 }
    },
    {
      id: 17, category: "Health & Welfare", type: "likert",
      text: "Health care spending should keep rising, even if that means higher taxes.",
      weights: { FIS: 1, ECO: 0.7 }
    },
    {
      id: 18, category: "Health & Welfare", type: "likert",
      text: "The government must provide free or heavily subsidized care for the elderly and disabled.",
      weights: { FIS: 0.8, EQ: 0.7, WSF: 0.4 }
    },
    {
      id: 19, category: "Health & Welfare", type: "likert",
      text: "Society should invest more in mental health support, even if it raises taxes.",
      weights: { FIS: 0.7, WSF: 0.5, EQ: 0.4 }
    },
    {
      id: 20, category: "Health & Welfare", type: "likert",
      text: "The government should regulate things like diet, alcohol or smoking more strictly to keep people healthy.",
      weights: { AUT: 0.8, PRI: -0.4, TEC: 0.3 }
    },
    {
      id: 21, category: "Health & Welfare", type: "likert",
      text: "Unemployment benefits should be high enough to live on comfortably, even if it reduces the incentive to find work.",
      weights: { EQ: 0.9, ECO: 0.7, FIS: 0.6 }
    },
    {
      id: 22, category: "Health & Welfare", type: "likert",
      text: "A guaranteed basic income for everyone would solve poverty better than current welfare.",
      weights: { ECO: 0.8, EQ: 0.8, FIS: 0.7 }
    },
    {
      id: 23, category: "Health & Welfare", type: "likert",
      text: "Childcare should be free or heavily subsidized, paid for by taxes.",
      weights: { FIS: 0.8, WSF: 0.7, EQ: 0.5 }
    },
    {
      id: 24, category: "Health & Welfare", type: "likert",
      text: "Both parents should get long paid leave for each child, even if employers have to cover more of the cost.",
      weights: { WSF: 0.8, EQ: 0.5, ECO: 0.4 }
    },
    {
      id: 25, category: "Health & Welfare", type: "likert",
      text: "The retirement age should be adjusted (up or down) based on economic needs, not kept fixed.",
      weights: { TRU: 0.4, FIS: -0.3 }
    },

    /* ============ Education & Families (26–35) ============ */
    {
      id: 26, category: "Education & Families", type: "likert",
      text: "Public schools and teachers should be given as much funding as needed, even if class sizes shrink.",
      weights: { FIS: 0.9, EQ: 0.5 }
    },
    {
      id: 27, category: "Education & Families", type: "likert",
      text: "Private schools and university fees should be taxed heavily to fund state schools and colleges.",
      weights: { EQ: 0.9, ECO: 0.7, CUL: 0.3 }
    },
    {
      id: 28, category: "Education & Families", type: "likert",
      text: "Everyone should have free access to higher education, even if taxes go up.",
      weights: { FIS: 0.8, EQ: 0.7, ECO: 0.5 }
    },
    {
      id: 29, category: "Education & Families", type: "likert",
      text: "Selective (grammar) schools encourage excellence and should not be banned by the government.",
      weights: { EQ: -0.7, CUL: -0.5, AUT: 0.2 }
    },
    {
      id: 30, category: "Education & Families", type: "likert",
      text: "Reducing child poverty is one of the most important goals of any government.",
      weights: { EQ: 0.8, WSF: 0.7, FIS: 0.5 }
    },
    {
      id: 31, category: "Education & Families", type: "likert",
      text: "Stable families (parents together, married or not) should be strongly encouraged by policy.",
      weights: { CUL: -0.7, REL: 0.3, WSF: 0.3 }
    },
    {
      id: 32, category: "Education & Families", type: "likert",
      text: "Single parents should receive extra support from the state (like housing or benefits).",
      weights: { EQ: 0.7, WSF: 0.7, CUL: 0.3 }
    },
    {
      id: 33, category: "Education & Families", type: "likert",
      text: "Laws should ensure fathers have as much responsibility and rights as mothers (e.g. custody, paternity leave).",
      weights: { WSF: 0.5, EQ: 0.5 }
    },
    {
      id: 34, category: "Education & Families", type: "likert",
      text: "It’s acceptable for someone to divorce without fault (no one “wins or loses” in marriage).",
      weights: { CUL: 0.8, REL: -0.6 }
    },
    {
      id: 35, category: "Education & Families", type: "likert",
      text: "The government should encourage (through policy) people to marry before having children.",
      weights: { CUL: -0.9, REL: 0.7 }
    },

    /* ============ Crime, Law & Order (36–47) ============ */
    {
      id: 36, category: "Crime, Law & Order", type: "likert",
      text: "We should hire more police officers to fight crime, even if it means less money for education or mental health programs.",
      weights: { AUT: 0.9, WSF: -0.3, FIS: -0.3 }
    },
    {
      id: 37, category: "Crime, Law & Order", type: "likert",
      text: "Prison sentences should be longer, even for minor violent or repeat offences, to deter crime.",
      weights: { AUT: 1, CUL: -0.3 }
    },
    {
      id: 38, category: "Crime, Law & Order", type: "likert",
      text: "Prisons should focus more on rehabilitation (education and therapy) rather than just punishment.",
      weights: { AUT: -0.9, CUL: 0.5, EQ: 0.3 }
    },
    {
      id: 39, category: "Crime, Law & Order", type: "likert",
      text: "Police should have stronger stop-and-search powers, even if it risks profiling innocent people.",
      weights: { AUT: 0.9, PRI: -0.7, EQ: -0.3 }
    },
    {
      id: 40, category: "Crime, Law & Order", type: "likert",
      text: "More CCTV cameras in public places are acceptable if they reduce violent crime.",
      weights: { AUT: 0.7, PRI: -0.9, TEC: 0.3 }
    },
    {
      id: 41, category: "Crime, Law & Order", type: "likert",
      text: "We should ban or strictly regulate items (knives, etc.) that are commonly used in violent crimes.",
      weights: { AUT: 0.6, WSF: 0.5 }
    },
    {
      id: 42, category: "Crime, Law & Order", type: "likert",
      text: "More shelters and support for domestic abuse victims should be a top priority, even if it means higher taxes.",
      weights: { WSF: 1, FIS: 0.4, EQ: 0.3 }
    },
    {
      id: 43, category: "Crime, Law & Order", type: "likert",
      text: "Ordinary citizens should have the right to own guns or Tasers for self-defence.",
      weights: { AUT: -0.6, PRI: 0.5, NAT: 0.3, CUL: -0.3 }
    },
    {
      id: 44, category: "Crime, Law & Order", type: "likert",
      text: "Recreational drug use (like cannabis) should be legalized and regulated, even if some people oppose it.",
      weights: { CUL: 0.8, AUT: -0.8, PRI: 0.4 }
    },
    {
      id: 45, category: "Crime, Law & Order", type: "likert",
      text: "People convicted of drug offences should be sent to treatment programs rather than prison.",
      weights: { AUT: -0.8, CUL: 0.6, EQ: 0.3 }
    },
    {
      id: 46, category: "Crime, Law & Order", type: "likert",
      text: "Government needs emergency powers (even temporary ones) to counter serious threats of terrorism.",
      weights: { AUT: 0.9, PRI: -0.8, TRU: 0.3 }
    },
    {
      id: 47, category: "Crime, Law & Order", type: "likert",
      text: "British citizens who fight for extremist groups abroad should lose citizenship or rights when they return.",
      weights: { AUT: 0.7, NAT: 0.7, IMM: -0.4 }
    },

    /* ============ Immigration & Integration (48–59) ============ */
    {
      id: 48, category: "Immigration & Integration", type: "likert",
      text: "Immigration levels should be guided first by economic need (like skill shortages), not just by cultural concerns.",
      weights: { IMM: 0.6, NAT: -0.5, ECO: -0.2 }
    },
    {
      id: 49, category: "Immigration & Integration", type: "likert",
      text: "We have a strong moral duty to accept refugees regardless of origin, even if it strains local resources.",
      weights: { IMM: 1, FOR: 0.5, EQ: 0.4 }
    },
    {
      id: 50, category: "Immigration & Integration", type: "likert",
      text: "Asylum claims should be processed abroad (in other safe countries) rather than in the UK.",
      weights: { IMM: -0.8, NAT: 0.5, AUT: 0.3 }
    },
    {
      id: 51, category: "Immigration & Integration", type: "likert",
      text: "People entering the UK illegally (without documentation) should be swiftly deported or barred.",
      weights: { IMM: -0.9, AUT: 0.6, NAT: 0.5 }
    },
    {
      id: 52, category: "Immigration & Integration", type: "likert",
      text: "Britain should have freedom to set its own immigration rules, separate from the EU (even if it complicates trade).",
      weights: { NAT: 0.8, FOR: -0.7, IMM: -0.4 }
    },
    {
      id: 53, category: "Immigration & Integration", type: "likert",
      text: "Government should spend on language and cultural programs to help immigrants integrate quickly.",
      weights: { IMM: 0.8, FIS: 0.4, CUL: 0.4 }
    },
    {
      id: 54, category: "Immigration & Integration", type: "likert",
      text: "Priority should be given to skilled migrants (doctors, engineers, etc.) over family reunions.",
      weights: { IMM: -0.3, ECO: -0.3, NAT: 0.2 }
    },
    {
      id: 55, category: "Immigration & Integration", type: "likert",
      text: "Immigration usually lowers wages and should therefore be limited.",
      weights: { IMM: -0.9, NAT: 0.4, EQ: -0.2 }
    },
    {
      id: 56, category: "Immigration & Integration", type: "likert",
      text: "High levels of immigration risk eroding national culture, so numbers must be tightly controlled.",
      weights: { IMM: -1, NAT: 0.8, CUL: -0.5 }
    },
    {
      id: 57, category: "Immigration & Integration", type: "likert",
      text: "Global cooperation (e.g. UN/EU agreements) on migration is more effective than tackling it alone.",
      weights: { FOR: 0.9, IMM: 0.6, NAT: -0.5 }
    },
    {
      id: 58, category: "Immigration & Integration", type: "likert",
      text: "Britain should make it easier for former nationals (and their children) abroad to return and settle here.",
      weights: { NAT: 0.4, IMM: 0.3 }
    },
    {
      id: 59, category: "Immigration & Integration", type: "likert",
      text: "Britain should accept a fixed quota of refugees each year, not simply whoever arrives.",
      weights: { IMM: -0.4, AUT: 0.3, TRU: 0.2 }
    },

    /* ============ Culture, Identity & Values (60–72) ============ */
    {
      id: 60, category: "Culture, Identity & Values", type: "likert",
      text: "It’s good for society to teach patriotism and pride in British history.",
      weights: { NAT: 0.9, CUL: -0.5 }
    },
    {
      id: 61, category: "Culture, Identity & Values", type: "likert",
      text: "Celebrating national identity brings people together, even in a diverse society.",
      weights: { NAT: 0.8, CUL: -0.3 }
    },
    {
      id: 62, category: "Culture, Identity & Values", type: "likert",
      text: "The monarchy should be preserved as a stable, non-political symbol of the nation.",
      weights: { CUL: -0.7, NAT: 0.6, DEM: -0.5, TRU: 0.3 }
    },
    {
      id: 63, category: "Culture, Identity & Values", type: "likert",
      text: "We should become a republic (abolish the monarchy) as soon as practicable.",
      weights: { DEM: 0.8, CUL: 0.6, NAT: -0.4, TRU: -0.3 }
    },
    {
      id: 64, category: "Culture, Identity & Values", type: "likert",
      text: "England should have its own separate parliament to balance Scotland/Wales devolution.",
      weights: { DEM: 0.7, NAT: 0.4 }
    },
    {
      id: 65, category: "Culture, Identity & Values", type: "likert",
      text: "Being British is more important than being English, Scottish, Welsh or Irish.",
      weights: { NAT: 0.7, DEM: -0.3 }
    },
    {
      id: 66, category: "Culture, Identity & Values", type: "likert",
      text: "Policymaking should focus on practical issues (jobs, houses, security) rather than identity issues or ‘culture wars’.",
      weights: { CUL: -0.4, WSF: 0.3, HOU: 0.2 }
    },
    {
      id: 67, category: "Culture, Identity & Values", type: "likert",
      text: "Mass immigration erodes traditional values and should be limited.",
      weights: { IMM: -1, CUL: -0.7, NAT: 0.7 }
    },
    {
      id: 68, category: "Culture, Identity & Values", type: "likert",
      text: "Encouraging different cultures is a British strength that should continue to be supported.",
      weights: { IMM: 0.8, CUL: 0.7, NAT: -0.6 }
    },
    {
      id: 69, category: "Culture, Identity & Values", type: "likert",
      text: "Faith-based schools (Christian, Muslim, etc.) should be allowed and funded by the state if parents want them.",
      weights: { REL: 0.9, CUL: -0.4 }
    },
    {
      id: 70, category: "Culture, Identity & Values", type: "likert",
      text: "Religious beliefs of citizens should have no influence on passing general laws (e.g. abortion laws).",
      weights: { REL: -1, CUL: 0.4 }
    },
    {
      id: 71, category: "Culture, Identity & Values", type: "likert",
      text: "Government policies (like affirmative action) are needed to ensure minorities get equal opportunities.",
      weights: { EQ: 0.8, CUL: 0.7 }
    },
    {
      id: 72, category: "Culture, Identity & Values", type: "likert",
      text: "Society should emphasise marriage and children as a central part of a person’s life.",
      weights: { CUL: -0.8, REL: 0.5 }
    },

    /* ============ Civil Liberties & Free Speech (73–82) ============ */
    {
      id: 73, category: "Civil Liberties & Free Speech", type: "likert",
      text: "Newspapers and broadcasters should not be state-funded or controlled by politicians.",
      weights: { PRI: 0.6, COR: 0.5, AUT: -0.3, TRU: -0.3 }
    },
    {
      id: 74, category: "Civil Liberties & Free Speech", type: "likert",
      text: "People who make knowingly false statements online should face criminal penalties.",
      weights: { AUT: 0.7, PRI: -0.6, TEC: 0.4 }
    },
    {
      id: 75, category: "Civil Liberties & Free Speech", type: "likert",
      text: "Social media should be regulated to remove harmful misinformation, even if it sometimes blocks legitimate opinion.",
      weights: { TEC: 0.8, AUT: 0.5, PRI: -0.5, TRU: 0.4 }
    },
    {
      id: 76, category: "Civil Liberties & Free Speech", type: "likert",
      text: "People should be free to say unpopular opinions in public, even if they offend some groups.",
      weights: { PRI: 0.7, AUT: -0.6, CUL: -0.4 }
    },
    {
      id: 77, category: "Civil Liberties & Free Speech", type: "likert",
      text: "Hate speech laws should ban comments that insult or threaten protected groups (race, religion, sexuality).",
      weights: { CUL: 0.7, AUT: 0.5, PRI: -0.4 }
    },
    {
      id: 78, category: "Civil Liberties & Free Speech", type: "likert",
      text: "Citizens should have the right to protest freely without excessive police interference.",
      weights: { PRI: 0.8, AUT: -0.7, COR: 0.3 }
    },
    {
      id: 79, category: "Civil Liberties & Free Speech", type: "likert",
      text: "Government surveillance (listening to phone calls, etc.) is acceptable only with strong oversight by courts.",
      weights: { PRI: 0.7, TRU: 0.3, AUT: -0.2 }
    },
    {
      id: 80, category: "Civil Liberties & Free Speech", type: "likert",
      text: "Strong encryption (online privacy) should be protected, even if it makes criminal investigations harder.",
      weights: { PRI: 1, AUT: -0.5, TEC: -0.4 }
    },
    {
      id: 81, category: "Civil Liberties & Free Speech", type: "likert",
      text: "We should never use secret prisons or torture, even for suspected terrorists.",
      weights: { PRI: 0.7, AUT: -0.7, FOR: 0.3, EQ: 0.3 }
    },
    {
      id: 82, category: "Civil Liberties & Free Speech", type: "likert",
      text: "Big tech companies should not sell personal data; government should strictly regulate personal data use.",
      weights: { TEC: 0.8, PRI: 0.7, COR: 0.4 }
    },

    /* ============ Technology & Future (83–88) ============ */
    {
      id: 83, category: "Technology & Future", type: "likert",
      text: "Artificial intelligence (AI) development should be tightly controlled by government.",
      weights: { TEC: 1, AUT: 0.3 }
    },
    {
      id: 84, category: "Technology & Future", type: "likert",
      text: "The UK should invest heavily in new technologies (robots, biotech) even if it means disruption to old industries.",
      weights: { TEC: -0.5, FIS: 0.4 }
    },
    {
      id: 85, category: "Technology & Future", type: "likert",
      text: "We should anticipate robots and AI will replace many jobs, so society must retrain workers accordingly.",
      weights: { TEC: 0.4, EQ: 0.5, FIS: 0.4 }
    },
    {
      id: 86, category: "Technology & Future", type: "likert",
      text: "Facial recognition cameras are useful for crime detection and should be expanded.",
      weights: { PRI: -1, AUT: 0.7, TEC: 0.3 }
    },
    {
      id: 87, category: "Technology & Future", type: "likert",
      text: "A secure national digital ID system (like electronic passports for all citizens) should be adopted for convenience.",
      weights: { PRI: -0.8, AUT: 0.5, TEC: 0.5, TRU: 0.4 }
    },
    {
      id: 88, category: "Technology & Future", type: "likert",
      text: "Online platforms (Google, Facebook) should be more accountable for content without outright banning them.",
      weights: { TEC: 0.7, TRU: 0.2 }
    },

    /* ============ Environment & Sustainability (89–97) ============ */
    {
      id: 89, category: "Environment & Sustainability", type: "likert",
      text: "Reaching net-zero carbon emissions by 2050 should be a top priority, even if it raises energy bills.",
      weights: { ENV: 1, FIS: 0.3, ECO: 0.3 }
    },
    {
      id: 90, category: "Environment & Sustainability", type: "likert",
      text: "Government should subsidise green energy (solar, wind) even if it means less coal and oil drilling.",
      weights: { ENV: 0.9, FIS: 0.5, ECO: 0.4 }
    },
    {
      id: 91, category: "Environment & Sustainability", type: "likert",
      text: "We should continue North Sea oil and gas exploration to ensure energy security.",
      weights: { ENV: -0.9, NAT: 0.4, ECO: -0.3 }
    },
    {
      id: 92, category: "Environment & Sustainability", type: "likert",
      text: "Building more nuclear reactors is essential for clean energy, despite high costs and risks.",
      weights: { ENV: 0.4, TRU: 0.3, FIS: 0.3 }
    },
    {
      id: 93, category: "Environment & Sustainability", type: "likert",
      text: "Individuals should accept higher food and transport costs to reduce carbon footprint.",
      weights: { ENV: 1 }
    },
    {
      id: 94, category: "Environment & Sustainability", type: "likert",
      text: "Fracking (shale gas) should be allowed if it reduces dependence on imported energy.",
      weights: { ENV: -1, NAT: 0.4, ECO: -0.3 }
    },
    {
      id: 95, category: "Environment & Sustainability", type: "likert",
      text: "We should follow or exceed EU environmental regulations even post-Brexit.",
      weights: { ENV: 0.8, FOR: 0.7, NAT: -0.4 }
    },
    {
      id: 96, category: "Environment & Sustainability", type: "likert",
      text: "Protecting natural habitats (trees, wetlands) is as important as economic development.",
      weights: { ENV: 0.9, HOU: -0.2 }
    },
    {
      id: 97, category: "Environment & Sustainability", type: "likert",
      text: "Investing in flood defenses and climate adaptation for communities is urgent.",
      weights: { ENV: 0.7, FIS: 0.5 }
    },

    /* ============ Governance & Democracy (98–108) ============ */
    {
      id: 98, category: "Governance & Democracy", type: "likert",
      text: "We should switch to proportional representation (PR) so smaller parties get fairer seats in Parliament.",
      weights: { DEM: 1, COR: 0.4, TRU: -0.2 }
    },
    {
      id: 99, category: "Governance & Democracy", type: "likert",
      text: "More decisions (like Brexit) should be decided by national referendums rather than politicians.",
      weights: { DEM: 0.8, TRU: -0.5, COR: 0.3 }
    },
    {
      id: 100, category: "Governance & Democracy", type: "likert",
      text: "The House of Lords should be fully elected and the monarchy reformed or scrapped for a modern democracy.",
      weights: { DEM: 0.9, CUL: 0.4, TRU: -0.3 }
    },
    {
      id: 101, category: "Governance & Democracy", type: "likert",
      text: "Local councils should have more power and funding; central government should decentralize more.",
      weights: { DEM: 0.8, AUT: -0.3, COR: 0.3 }
    },
    {
      id: 102, category: "Governance & Democracy", type: "likert",
      text: "Devolved nations (Scotland, Wales, NI) should make almost all of their own policy without Westminster interference.",
      weights: { DEM: 0.7, NAT: -0.5 }
    },
    {
      id: 103, category: "Governance & Democracy", type: "likert",
      text: "England should have its own parliament or assemblies to balance the UK nations.",
      weights: { DEM: 0.7, NAT: 0.3 }
    },
    {
      id: 104, category: "Governance & Democracy", type: "likert",
      text: "We should strengthen ties with the EU (single market, free movement) even after Brexit.",
      weights: { FOR: 1, NAT: -0.7, IMM: 0.5 }
    },
    {
      id: 105, category: "Governance & Democracy", type: "likert",
      text: "British courts should still respect decisions of the European Court of Human Rights (ECHR).",
      weights: { FOR: 0.8, NAT: -0.7, PRI: 0.3, TRU: 0.3 }
    },
    {
      id: 106, category: "Governance & Democracy", type: "likert",
      text: "The UK should give up nuclear weapons to reduce global threats.",
      weights: { FOR: 0.6, NAT: -0.6, AUT: -0.5, ENV: 0.3 }
    },
    {
      id: 107, category: "Governance & Democracy", type: "likert",
      text: "Defense and intelligence agencies should get more funding due to global threats.",
      weights: { AUT: 0.7, NAT: 0.6, FOR: -0.3, FIS: 0.2 }
    },
    {
      id: 108, category: "Governance & Democracy", type: "likert",
      text: "We should pledge more foreign aid to poor countries and honour international commitments.",
      weights: { FOR: 0.9, EQ: 0.5, NAT: -0.4 }
    },

    /* ============ Corruption & Accountability (109–115) ============ */
    {
      id: 109, category: "Corruption & Accountability", type: "likert",
      text: "Politicians should not be allowed to have outside jobs or receive high pay in other industries.",
      weights: { COR: 0.9, TRU: -0.3 }
    },
    {
      id: 110, category: "Corruption & Accountability", type: "likert",
      text: "Political parties should not accept donations from wealthy individuals or corporations.",
      weights: { COR: 1, EQ: 0.4, TRU: -0.3 }
    },
    {
      id: 111, category: "Corruption & Accountability", type: "likert",
      text: "Meetings between government ministers and business lobbyists should be fully transparent or banned.",
      weights: { COR: 1, TRU: -0.2 }
    },
    {
      id: 112, category: "Corruption & Accountability", type: "likert",
      text: "MPs or ministers holding second jobs should face strict limits or penalties.",
      weights: { COR: 0.8 }
    },
    {
      id: 113, category: "Corruption & Accountability", type: "likert",
      text: "If a minister knowingly lies to Parliament, they should face criminal charges.",
      weights: { COR: 0.9, AUT: 0.3, TRU: -0.4 }
    },
    {
      id: 114, category: "Corruption & Accountability", type: "likert",
      text: "All political meetings and expenses should be made public in real time.",
      weights: { COR: 0.9, TEC: 0.2, PRI: -0.2 }
    },
    {
      id: 115, category: "Corruption & Accountability", type: "likert",
      text: "There should be term limits for MPs or leaders to prevent career politicians.",
      weights: { COR: 0.7, DEM: 0.6, TRU: -0.4 }
    },

    /* ============ Personal Values & Worldview (116–125) ============ */
    {
      id: 116, category: "Personal Values & Worldview", type: "likert",
      text: "Most problems (poverty, addiction, unemployment) are caused by individual choices, not society.",
      weights: { EQ: -0.9, ECO: -0.6, CUL: -0.3 }
    },
    {
      id: 117, category: "Personal Values & Worldview", type: "likert",
      text: "Society (like economy, education, upbringing) is mostly responsible for people’s life outcomes.",
      weights: { EQ: 0.9, ECO: 0.6 }
    },
    {
      id: 118, category: "Personal Values & Worldview", type: "likert",
      text: "Economic growth (GDP) must sometimes take a back seat to protect the environment and future generations.",
      weights: { ENV: 1, ECO: 0.3 }
    },
    {
      id: 119, category: "Personal Values & Worldview", type: "likert",
      text: "Global cooperation (EU, UN, trade pacts) benefits Britain more than national self-reliance.",
      weights: { FOR: 1, NAT: -0.7 }
    },
    {
      id: 120, category: "Personal Values & Worldview", type: "likert",
      text: "Rapid social changes (in religion, identity, language) make communities feel unmoored and should be slowed.",
      weights: { CUL: -0.9, NAT: 0.4, IMM: -0.3 }
    },
    {
      id: 121, category: "Personal Values & Worldview", type: "likert",
      text: "Opportunities should be made equal (even if outcomes differ), rather than forcing equal results for everyone.",
      weights: { EQ: -0.6, ECO: -0.3 }
    },
    {
      id: 122, category: "Personal Values & Worldview", type: "likert",
      text: "Britain’s own laws should never be overruled by outside bodies (EU or international courts).",
      weights: { NAT: 1, FOR: -0.8 }
    },
    {
      id: 123, category: "Personal Values & Worldview", type: "likert",
      text: "Individuals and communities (not government) should solve social problems wherever possible.",
      weights: { ECO: -0.8, FIS: -0.7, EQ: -0.5 }
    },
    {
      id: 124, category: "Personal Values & Worldview", type: "likert",
      text: "Politicians should promote traditional moral values as part of their policy.",
      weights: { REL: 0.8, CUL: -0.8, AUT: 0.4 }
    },
    {
      id: 125, category: "Personal Values & Worldview", type: "likert",
      text: "We should accept major changes (AI, global shifts) if it means long-term improvement, even if uncomfortable now.",
      weights: { CUL: 0.5, FOR: 0.4, TEC: -0.3, TRU: 0.3 }
    },

    /* ============ Ranking question (126) ============
       The design paper's closing note: "Some questions could be presented
       as 'Rank the following in order of importance' with items like:
       safety, economy, cultural identity, environment, personal freedom."
       Each item carries its own axis weights. The engine converts rank
       position to a value from +1 (top) down to -1 (bottom). */
    {
      id: 126, category: "Personal Values & Worldview", type: "rank",
      text: "Rank the following in order of importance to you.",
      items: [
        { id: "safety",   label: "Safety",            weights: { AUT: 0.7, WSF: 0.6 } },
        { id: "economy",  label: "Economy",           weights: { FIS: -0.3, ENV: -0.3 } },
        { id: "identity", label: "Cultural identity", weights: { NAT: 0.8, CUL: -0.5, IMM: -0.3 } },
        { id: "environment", label: "Environment",    weights: { ENV: 0.9 } },
        { id: "freedom",  label: "Personal freedom",  weights: { PRI: 0.8, AUT: -0.6 } }
      ]
    },

    /* ============ Scenario & multiple-choice items (127–129) ============
       These exercise the scenario and multiple-choice question types the
       site supports. They are indirect, psychologically framed probes in
       the spirit of the paper's neutral-question rules, and can be
       removed or expanded freely without touching the engine. */
    {
      id: 127, category: "Personal Values & Worldview", type: "scenario",
      situation:
        "Imagine your local council unexpectedly has extra money this year " +
        "and must choose a single use for it.",
      text: "Which use would you choose?",
      options: [
        { label: "More visible police patrols in the area",
          weights: { AUT: 0.8, WSF: 0.3 } },
        { label: "Building genuinely affordable homes",
          weights: { HOU: 0.9, EQ: 0.4, FIS: 0.4 } },
        { label: "Cutting local taxes and charges for everyone",
          weights: { ECO: -0.8, FIS: -0.7 } },
        { label: "Insulating homes and expanding green spaces",
          weights: { ENV: 0.9, FIS: 0.3 } }
      ]
    },
    {
      id: 128, category: "Personal Values & Worldview", type: "scenario",
      situation:
        "A large employer wants to open a new site near your community. It " +
        "promises hundreds of jobs, but will increase pollution and put " +
        "pressure on local housing.",
      text: "What is closest to your reaction?",
      options: [
        { label: "Welcome it — jobs and growth come first",
          weights: { ECO: -0.6, ENV: -0.6 } },
        { label: "Allow it, but only under strict environmental and housing conditions",
          weights: { TEC: 0.5, ENV: 0.4, HOU: 0.3 } },
        { label: "Oppose it — the harm to the area outweighs the jobs",
          weights: { ENV: 0.8, ECO: 0.3 } },
        { label: "Let local residents decide directly in a vote",
          weights: { DEM: 0.9, TRU: -0.3 } }
      ]
    },
    {
      id: 129, category: "Personal Values & Worldview", type: "choice",
      text: "When a major news story breaks, whose account do you tend to trust most?",
      options: [
        { label: "Official statements and experts",
          weights: { TRU: 0.9 } },
        { label: "Established journalists and broadcasters",
          weights: { TRU: 0.5 } },
        { label: "Independent voices online",
          weights: { TRU: -0.6, COR: 0.4 } },
        { label: "No one — I work it out for myself",
          weights: { TRU: -0.9, COR: 0.5, PRI: 0.3 } }
      ]
    }
  ],

  /* ------------------------------------------------------------------
     5. PARTY PROFILES — 8 parties spanning centre to extreme on both
        sides, exactly as defined in the design paper, each with:
          - description   (from the paper)
          - credibility   (0–1; the paper's credibility weight — lower
                           credibility applies a "capture" penalty when
                           the cosine score is adjusted)
          - vector        (full 17-axis profile tuned to the platform;
                           the Green vector uses the paper's example
                           values verbatim, with the remaining axes
                           "zero or small" as the paper instructs)
          - matchReason / mismatchReason (prose fragments used to build
                           the written analysis)
          - spectrum      (0–1 position along the left→right horseshoe
                           arc used ONLY by the circular visualisation:
                           0 = extreme left, 0.5 = centre, 1 = extreme
                           right. Purely presentational — it plays no
                           part in scoring.)
        `family` is the ideological position from the paper, only shown
        on the results screen.
     ------------------------------------------------------------------ */
  parties: [
    {
      id: "green",
      name: "Green Party",
      family: "Far-left ecological",
      credibility: 0.95,
      spectrum: 0.13,
      description:
        "Strong on redistribution, maximum environmental priority, pro-EU, " +
        "high social liberalism and a strong focus on women’s safety. " +
        "Strong grassroots funding with fewer lobby ties.",
      vector: {
        // Paper's example vector, verbatim:
        ECO: 0.8, EQ: 1, FIS: 0.6, ENV: 1, COR: 0.7, IMM: 0.5, FOR: 0.7,
        CUL: 0.5, PRI: 0.8, AUT: -0.3, NAT: -0.2, WSF: 0.9, DEM: 0.5,
        // Remaining axes "zero or small", tuned to the platform:
        HOU: 0.6, TEC: 0.3, REL: -0.4, TRU: 0.1
      },
      matchReason:
        "combines heavy redistribution and public investment with the " +
        "strongest environmental programme and a practical focus on safety, " +
        "housing and family welfare",
      mismatchReason:
        "puts the environment and redistribution above growth, borders and " +
        "tradition, so it scores poorly for voters who prioritise low taxes, " +
        "national identity or tight immigration control"
    },
    {
      id: "labour",
      name: "Labour Party",
      family: "Centre-left",
      credibility: 0.85,
      spectrum: 0.3,
      description:
        "Social democracy: increased public spending, workers’ rights, " +
        "moderate redistribution and strong NHS support. Progressive on many " +
        "social issues, decent on the environment, pro-integration. Some " +
        "union ties and moderate lobby exposure.",
      vector: {
        ECO: 0.6, FIS: 0.7, AUT: 0.1, PRI: 0.2, CUL: 0.5, IMM: 0.4,
        NAT: 0.1, FOR: 0.4, ENV: 0.5, HOU: 0.6, WSF: 0.7, COR: 0.2,
        DEM: 0.2, TEC: 0.4, REL: -0.2, EQ: 0.7, TRU: 0.4
      },
      matchReason:
        "pairs stronger public services and workers’ rights with a " +
        "pragmatic, institution-friendly approach to government",
      mismatchReason:
        "is more cautious than the further-left options on redistribution " +
        "and constitutional reform, and its establishment ties cost it with " +
        "anti-lobby voters"
    },
    {
      id: "socialist",
      name: "Socialist / Communist Party",
      family: "Far-left",
      credibility: 0.80,
      spectrum: 0.03,
      description:
        "Extreme redistribution and public ownership, anti-NATO and " +
        "anti-nuclear-weapons, very progressive social stances, strong civil " +
        "liberties and fiercely anti-corporate. Very ideological, but fringe " +
        "influence.",
      vector: {
        ECO: 1, FIS: 0.9, AUT: -0.6, PRI: 0.6, CUL: 0.8, IMM: 0.7,
        // FOR is slightly negative: internationalist in outlook but opposed
        // to the Western alliance structures (NATO) the FOR axis includes.
        NAT: -0.6, FOR: -0.2, ENV: 0.6, HOU: 0.9, WSF: 0.6, COR: 0.9,
        DEM: 0.5, TEC: 0.5, REL: -0.7, EQ: 1, TRU: -0.5
      },
      matchReason:
        "offers the most radical programme of public ownership, wealth " +
        "redistribution and anti-corporate reform available",
      mismatchReason:
        "demands a level of economic transformation and institutional " +
        "distrust that most voters’ answers do not support, and its " +
        "fringe position reduces its credibility weighting"
    },
    {
      id: "libdem",
      name: "Liberal Democrats",
      family: "Centre",
      credibility: 0.90,
      spectrum: 0.5,
      description:
        "Moderate left: pro-market with strong social programmes, strong " +
        "civil liberties, electoral reform, pro-EU, moderate on environment " +
        "and public spending, pro open immigration, values freedom and " +
        "merit. Established honest image.",
      vector: {
        ECO: 0.1, FIS: 0.3, AUT: -0.3, PRI: 0.9, CUL: 0.7, IMM: 0.7,
        NAT: -0.4, FOR: 0.9, ENV: 0.6, HOU: 0.3, WSF: 0.5, COR: 0.6,
        DEM: 0.9, TEC: 0.3, REL: -0.5, EQ: 0.4, TRU: 0.5
      },
      matchReason:
        "blends personal freedom, civil liberties and internationalism with " +
        "moderate, market-friendly social programmes and the strongest " +
        "commitment to electoral reform",
      mismatchReason:
        "sits close to the centre, so voters with strong economic or " +
        "cultural convictions in either direction find it too moderate"
    },
    {
      id: "conservative",
      name: "Conservative Party",
      family: "Centre-right",
      credibility: 0.70,
      spectrum: 0.68,
      description:
        "Free-market and low taxes, more police and defence, moderate social " +
        "conservatism, moderate climate action, pro-Brexit sovereignty, " +
        "moderate on welfare. Accused of lobby influence.",
      vector: {
        ECO: -0.7, FIS: -0.6, AUT: 0.6, PRI: -0.3, CUL: -0.4, IMM: -0.5,
        NAT: 0.7, FOR: -0.2, ENV: 0.1, HOU: -0.4, WSF: 0.2, COR: -0.4,
        DEM: -0.6, TEC: -0.3, REL: 0.2, EQ: -0.6, TRU: 0.3
      },
      matchReason:
        "combines free-market economics and lower taxes with firm policing, " +
        "national sovereignty and a cautious approach to social change",
      mismatchReason:
        "opposes the redistribution, public investment and constitutional " +
        "reform that left-leaning or reform-minded answers point towards, " +
        "and its lobby exposure applies a notable credibility penalty"
    },
    {
      id: "reform",
      name: "Reform UK",
      family: "Right-populist",
      credibility: 0.75,
      spectrum: 0.8,
      description:
        "Tough immigration policy, nationalist, low taxes and business " +
        "friendly, anti-EU, law-and-order focus, sceptical of climate " +
        "urgency. Populist but seasoned campaigners.",
      vector: {
        ECO: -0.8, FIS: -0.7, AUT: 0.7, PRI: -0.2, CUL: -0.6, IMM: -0.9,
        NAT: 0.9, FOR: -0.8, ENV: -0.7, HOU: -0.3, WSF: 0.1, COR: 0.5,
        DEM: 0.4, TEC: -0.4, REL: 0.1, EQ: -0.7, TRU: -0.6
      },
      matchReason:
        "offers the firmest mainstream stance on immigration control and " +
        "national sovereignty alongside low-tax, anti-establishment politics",
      mismatchReason:
        "scores poorly for voters who favour public services, environmental " +
        "action or openness, because its platform concentrates on borders, " +
        "sovereignty and tax cuts"
    },
    {
      id: "nationalist",
      name: "Nationalist Party",
      family: "Far-right",
      credibility: 0.60,
      spectrum: 0.93,
      description:
        "Extreme nationalism, minimal immigration, isolationist, traditional " +
        "values, anti-globalist and often anti-establishment, with a strong " +
        "law-and-order stance. Very fringe, less credible.",
      vector: {
        ECO: -0.3, FIS: -0.2, AUT: 0.9, PRI: -0.4, CUL: -0.9, IMM: -1,
        NAT: 1, FOR: -1, ENV: -0.5, HOU: 0.1, WSF: 0.2, COR: 0.4,
        DEM: -0.2, TEC: 0.1, REL: 0.4, EQ: -0.8, TRU: -0.8
      },
      matchReason:
        "puts national identity, borders and order above every other " +
        "consideration",
      mismatchReason:
        "requires an intensity of nationalism and cultural traditionalism " +
        "that few answer patterns support, and its fringe status brings the " +
        "second-largest credibility penalty in the model"
    },
    {
      id: "religious",
      name: "Religious Fundamentalist Party",
      family: "Far-right",
      credibility: 0.55,
      spectrum: 0.98,
      description:
        "Very conservative social values with religion central to law, " +
        "pro-market economics, isolationist, authoritarian on morals and a " +
        "low environmental priority. Extreme ideological stance.",
      vector: {
        ECO: -0.6, FIS: -0.4, AUT: 0.8, PRI: -0.3, CUL: -1, IMM: -0.6,
        NAT: 0.8, FOR: -0.7, ENV: -0.4, HOU: -0.1, WSF: 0.3, COR: 0.1,
        DEM: -0.4, TEC: 0.2, REL: 1, EQ: -0.5, TRU: -0.3
      },
      matchReason:
        "is the only profile that places faith and traditional moral values " +
        "at the centre of law-making",
      mismatchReason:
        "demands that religion shape public law — a position most answer " +
        "patterns reject — and it carries the largest credibility " +
        "penalty in the model"
    }
  ],

  /* ------------------------------------------------------------------
     6. EXPLANATION TEMPLATES — the paper's "Specific templates based on
        top axes". Each rule fires when ALL of `all` and (if present) at
        least one of `any` hold. Conditions compare the user's normalised
        axis score against `min` (score >= min) or `max` (score <= max).
        Note: where the paper says "High CUL" meaning *traditional*
        values, the condition uses the CUL axis's negative pole, because
        CONFIG.axes defines CUL+ as progressive.
     ------------------------------------------------------------------ */
  templates: [
    {
      id: "practical-safety",
      // "High WSF (women/family safety) + High HOU/EQ"
      all: [{ axis: "WSF", min: 0.35 }],
      any: [{ axis: "HOU", min: 0.25 }, { axis: "EQ", min: 0.25 }],
      text:
        "You clearly want practical safety and economic security. Parties " +
        "that promise better policing, courts, housing support and welfare " +
        "will meet these goals – not those focusing solely on " +
        "immigration cuts."
    },
    {
      id: "internationalist",
      // "High IMM openness + High FOR"
      all: [{ axis: "IMM", min: 0.30 }, { axis: "FOR", min: 0.30 }],
      text:
        "You are internationally minded, welcoming to migrants. Parties " +
        "that emphasize trade, aid and integration (Green, Lib Dem) match " +
        "you better than nationalist parties."
    },
    {
      id: "reformer",
      // "High COR + High DEM"
      all: [{ axis: "COR", min: 0.30 }, { axis: "DEM", min: 0.30 }],
      text:
        "Anti-corruption and democratic reform matter to you. Parties with " +
        "more grassroots accountability (Green, Lib Dem) suit you, whereas " +
        "big-party ties (even Labour/Conservatives) earn a penalty for " +
        "potential capture."
    },
    {
      id: "order-tradition",
      // "High AUT + High CUL [traditional]" — traditional = CUL negative pole
      all: [{ axis: "AUT", min: 0.30 }, { axis: "CUL", max: -0.30 }],
      text:
        "You favor strong social order and traditional values. Centrist or " +
        "right parties (Conservative, Nationalist) match more, rather than " +
        "socially liberal parties."
    },
    {
      id: "private-faithful",
      // "High PRI + High REL"
      all: [{ axis: "PRI", min: 0.30 }, { axis: "REL", min: 0.30 }],
      text:
        "You value personal privacy and religious values. This combination " +
        "is rare; possibly small socially conservative parties or " +
        "libertarian-leaning groups might align best."
    },
    {
      id: "economic-left",
      // "High ECO + High EQ"
      all: [{ axis: "ECO", min: 0.35 }, { axis: "EQ", min: 0.35 }],
      text:
        "You lean left economically, favoring heavy redistribution. Green " +
        "or Socialist parties will implement wealth taxes and public " +
        "ownership more than others."
    }
  ],

  /* ------------------------------------------------------------------
     7. CONTRADICTION RULES — the paper's "Contradiction insights".
        Each rule can require axis conditions (`all`, same format as
        templates) and/or that the best-matching party is in
        `topMatchIn`. The text is shown in the "tensions" panel and
        woven into the written analysis.
        (Generic user-vs-party tensions are detected separately by the
        engine using the tension thresholds in CONFIG.scoring.)
     ------------------------------------------------------------------ */
  contradictions: [
    {
      id: "safety-vs-borders",
      title: "Safety priorities vs immigration focus",
      // "womens' safety very high but also restrict immigration very high"
      all: [{ axis: "WSF", min: 0.35 }, { axis: "IMM", max: -0.35 }],
      text:
        "Your priority is reducing violence, but remember: most violence " +
        "against women happens domestically. Policies targeting local " +
        "services and education address this more than border controls."
    },
    {
      id: "anticorruption-vs-establishment",
      title: "Anti-corruption values vs an establishment match",
      // "anti-corruption high but the top match is Labour or Conservative"
      all: [{ axis: "COR", min: 0.35 }],
      topMatchIn: ["labour", "conservative"],
      text:
        "You indicated anti-lobby concerns, so note these parties have " +
        "historically taken big donations. A Green or Liberal Democrat " +
        "match might address your values with less establishment influence."
    },
    {
      id: "equality-vs-inequality",
      title: "Stated equality vs policies that increase inequality",
      // The paper's opening example: "a voter saying 'I care about equality'
      // while also favouring policies that increase inequality."
      all: [{ axis: "EQ", min: 0.35 }, { axis: "ECO", max: -0.30 }],
      text:
        "You said equality matters to you, yet you also favoured low-tax, " +
        "free-market policies that tend to widen income gaps. It may be " +
        "worth deciding which of these you would give up first, because " +
        "parties rarely deliver both at once."
    }
  ],

  /* ------------------------------------------------------------------
     8. HIDDEN PSYCHOLOGICAL PROFILE
        Traits shown on the results dashboard. Each trait score is a
        weighted blend of normalised axis scores (weights need not sum
        to 1; the engine normalises by the sum of |weights|). The trait
        text is chosen by where the blended score falls.
     ------------------------------------------------------------------ */
  psychology: [
    {
      id: "order",
      name: "Order vs autonomy",
      lowLabel: "Autonomy-seeking", highLabel: "Order-seeking",
      formula: { AUT: 1, PRI: -0.5 },
      highText:
        "You are reassured by clear rules, firm enforcement and visible " +
        "authority; disorder feels like a threat to the things you value.",
      midText:
        "You want rules that work but resist authority for its own sake, " +
        "judging each restriction on its practical merits.",
      lowText:
        "You instinctively resist being told what to do and extend the same " +
        "courtesy to others; coercion has to clear a very high bar with you."
    },
    {
      id: "openness",
      name: "Openness to change",
      lowLabel: "Continuity-minded", highLabel: "Change-embracing",
      formula: { CUL: 1, IMM: 0.5, FOR: 0.3 },
      highText:
        "Novelty energises rather than unsettles you — new people, new " +
        "norms and new ideas read to you as opportunity.",
      midText:
        "You are selectively open: comfortable with change that proves " +
        "itself, cautious about change imposed quickly or carelessly.",
      lowText:
        "You draw strength from continuity — familiar institutions, " +
        "shared traditions and a stable pace of social change."
    },
    {
      id: "trust",
      name: "Institutional trust",
      lowLabel: "Sceptical", highLabel: "Trusting",
      formula: { TRU: 1, COR: -0.5 },
      highText:
        "Your default is to extend good faith to experts, courts and " +
        "officials until they individually forfeit it.",
      midText:
        "You extend conditional trust — institutions get the benefit of " +
        "the doubt, but you watch them closely.",
      lowText:
        "You assume power protects itself. Institutions have to earn your " +
        "trust transaction by transaction, and few fully do."
    },
    {
      id: "responsibility",
      name: "Responsibility attribution",
      lowLabel: "Individual-focused", highLabel: "Structure-focused",
      formula: { EQ: 1, ECO: 0.6 },
      highText:
        "When you see hardship you look first at circumstances — the " +
        "economy, upbringing, luck — and expect society to correct them.",
      midText:
        "You split responsibility between the person and their " +
        "circumstances, resisting single-cause explanations of success or " +
        "failure.",
      lowText:
        "You see outcomes chiefly as the product of individual choices and " +
        "effort, and you are wary of systems that blur that link."
    },
    {
      id: "horizon",
      name: "Time horizon",
      lowLabel: "Present-focused", highLabel: "Future-focused",
      formula: { ENV: 1, TEC: -0.3 },
      highText:
        "You weigh the interests of people not yet born almost as heavily " +
        "as those alive today, and you accept present costs for future gain.",
      midText:
        "You balance today's bills against tomorrow's risks, unwilling to " +
        "sacrifice either entirely.",
      lowText:
        "You focus on concrete, present-day concerns — bills, jobs, " +
        "safety — over speculative long-term projects."
    },
    {
      id: "belonging",
      name: "Group belonging",
      lowLabel: "Universalist", highLabel: "Rooted",
      formula: { NAT: 1, FOR: -0.6 },
      highText:
        "Belonging is central to your worldview: nation, place and shared " +
        "identity are things politics should actively protect.",
      midText:
        "You value roots and belonging without treating outsiders as a " +
        "threat; identity matters but doesn't dominate.",
      lowText:
        "You see people primarily as individuals and humanity as one " +
        "community; borders and flags carry little moral weight for you."
    }
  ]
};
