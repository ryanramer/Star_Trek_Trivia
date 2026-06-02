'use strict';

/* ============================================================
   Star Trek Trivia - app.js
   Verbose, timestamped logging per project conventions.
   Runs from file:// (no server required).
   ============================================================ */

// ---------- LOGGING ----------
const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const ACTIVE_LEVEL = LOG_LEVELS.DEBUG;
const LOG_STORAGE_KEY = 'trivia_log';
const LOG_BUFFER_LIMIT = 500;

function _now() { return new Date().toISOString(); }

function log(level, msg, data) {
    const ts = _now();
    const levelName = Object.keys(LOG_LEVELS).find(k => LOG_LEVELS[k] === level) || 'INFO';
    if (level < ACTIVE_LEVEL) return;
    const line = `[${ts}] [${levelName}] ${msg}`;
    if (data !== undefined) console.log(line, data); else console.log(line);
    try {
        const buf = JSON.parse(localStorage.getItem(LOG_STORAGE_KEY) || '[]');
        buf.push({ ts, level: levelName, msg, data: data === undefined ? null : data });
        if (buf.length > LOG_BUFFER_LIMIT) buf.splice(0, buf.length - LOG_BUFFER_LIMIT);
        localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(buf));
    } catch (e) { /* localStorage may be unavailable in some contexts */ }
}
const logD = (m, d) => log(LOG_LEVELS.DEBUG, m, d);
const logI = (m, d) => log(LOG_LEVELS.INFO,  m, d);
const logW = (m, d) => log(LOG_LEVELS.WARN,  m, d);
const logE = (m, d) => log(LOG_LEVELS.ERROR, m, d);

// ---------- STATE ----------
const state = {
    allQuestions: [],
    conflicts: null,          // Map<id, Set<id>> — anti-spoiler conflict graph
    settings: {
        series: 'ALL',
        difficulty: 'ALL',
        count: 25,
        category: 'ALL',
        type: 'ALL'
    },
    questions: [],
    currentIndex: 0,
    score: 0,
    answers: [],
    selectedAnswer: null
};

// Anti-spoiler tuning: an answer term is treated as a "distinctive" spoiler
// only if it is at least this long and appears in at most this many question
// texts across the whole corpus. Ubiquitous terms (e.g. "Vulcan", "Kirk")
// exceed the frequency cap and are ignored, avoiding false positives.
const SPOILER_MIN_LEN = 5;
const SPOILER_FREQ_MAX = 3;

// ---------- DOM HELPERS ----------
function $(id) { return document.getElementById(id); }

function show(screen) {
    ['setup-screen', 'quiz-screen', 'results-screen'].forEach(s => {
        $(s).classList.toggle('hidden', s !== screen);
    });
    logI(`Showing screen: ${screen}`);
}

function shuffle(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

// ---------- ANTI-SPOILER CONFLICT GRAPH ----------
// Two questions "conflict" when one would give away the other's answer if both
// appeared in the same session. We build an undirected graph of such pairs once
// at startup, from three sources:
//   1. Automatic: a question's distinctive correct-answer term appearing in the
//      text of another question (rarity-weighted to skip ubiquitous terms).
//   2. Explicit q.conflictsWith: ["DS9-100", ...] — hand-tuned force-exclude.
//   3. Explicit q.topic: "dominion-war" — all questions sharing a topic conflict.
function normalizeText(s) {
    return String(s == null ? '' : s)
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildConflictGraph(questions) {
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;

    // Pre-normalize each question's "revealing" text, keyed by id. We include the
    // question, the explanation (shown as feedback), and the CORRECT answer (also
    // revealed as feedback) — but NOT the wrong distractors, which are never
    // presented as fact and would otherwise inflate term frequencies with noise.
    const fullText = new Map();
    for (const q of questions) {
        const correct = (q.answers && q.correct != null) ? q.answers[q.correct] : '';
        fullText.set(q.id, normalizeText(`${q.question} ${q.explanation || ''} ${correct || ''}`));
    }
    const texts = Array.from(fullText.values());
    const corpusFreq = phrase => {
        let c = 0;
        for (const t of texts) { if (t.includes(phrase)) c++; }
        return c;
    };

    const graph = new Map();
    const link = (a, b) => {
        if (a === b) return;
        if (!graph.has(a)) graph.set(a, new Set());
        if (!graph.has(b)) graph.set(b, new Set());
        graph.get(a).add(b);
        graph.get(b).add(a);
    };

    // 1) Automatic rarity-weighted literal-leak detection.
    let autoLinks = 0;
    for (const q of questions) {
        if (q.type !== 'multiple_choice') continue;          // T/F answers ("True") are not distinctive
        const term = normalizeText(q.answers[q.correct]);
        if (term.length < SPOILER_MIN_LEN) continue;
        if (corpusFreq(term) > SPOILER_FREQ_MAX) continue;   // too common to be a real spoiler
        for (const other of questions) {
            if (other.id === q.id) continue;
            if (fullText.get(other.id).includes(term)) { link(q.id, other.id); autoLinks++; }
        }
    }

    // 2) Explicit conflictsWith overrides.
    let explicitLinks = 0;
    for (const q of questions) {
        if (Array.isArray(q.conflictsWith)) {
            for (const id of q.conflictsWith) { link(q.id, id); explicitLinks++; }
        }
    }

    // 3) Topic clusters — every pair sharing a topic conflicts.
    const byTopic = new Map();
    for (const q of questions) {
        if (q.topic) {
            if (!byTopic.has(q.topic)) byTopic.set(q.topic, []);
            byTopic.get(q.topic).push(q.id);
        }
    }
    let topicLinks = 0;
    for (const ids of byTopic.values()) {
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) { link(ids[i], ids[j]); topicLinks++; }
        }
    }

    const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
    logI(`Conflict graph built: ${graph.size} questions have conflicts ` +
         `(auto=${autoLinks}, explicit=${explicitLinks}, topic=${topicLinks} directed links) ` +
         `in ${(t1 - t0).toFixed(1)}ms`);
    return graph;
}

// Greedy selection of up to n questions from an already-shuffled pool such that
// no two chosen questions conflict. If conflicts make it impossible to reach n,
// backfill from the deferred (conflicting) remainder so we never under-deliver.
function selectNonConflicting(pool, n) {
    const graph = state.conflicts || new Map();
    const chosen = [];
    const blocked = new Set();   // ids that conflict with something already chosen
    const deferred = [];

    for (const q of pool) {
        if (chosen.length >= n) break;
        if (blocked.has(q.id)) { deferred.push(q); continue; }
        chosen.push(q);
        const cs = graph.get(q.id);
        if (cs) cs.forEach(id => blocked.add(id));
    }

    if (chosen.length < n && deferred.length > 0) {
        const backfill = Math.min(n - chosen.length, deferred.length);
        logW(`Anti-spoiler: only ${chosen.length} non-conflicting question(s) available ` +
             `for a requested ${n}; backfilling ${backfill} from conflicting remainder ` +
             `(pool too small/narrow to avoid all spoilers).`);
        for (const q of deferred) {
            if (chosen.length >= n) break;
            chosen.push(q);
        }
    } else {
        logI(`Anti-spoiler: selected ${chosen.length} non-conflicting question(s); ` +
             `${deferred.length} candidate(s) skipped as potential spoilers.`);
    }
    return chosen;
}

// ---------- INITIALIZATION ----------
function init() {
    logI('=== Star Trek Trivia booting ===');
    logI(`User agent: ${navigator.userAgent}`);

    if (!window.TRIVIA_DATA || !Array.isArray(window.TRIVIA_DATA)) {
        logE('TRIVIA_DATA missing or invalid');
        $('main').innerHTML =
            '<div class="error">' +
            '<strong>ERROR:</strong> data.js was not loaded or is invalid.<br>' +
            'If you just cloned the repo, run <code>build_data.ps1</code> in PowerShell to generate data.js from the JSON files.' +
            '</div>';
        return;
    }
    state.allQuestions = window.TRIVIA_DATA;
    logI(`Loaded ${state.allQuestions.length} questions from data.js`);

    // Distribution stats
    const dist = {};
    for (const q of state.allQuestions) {
        const key = `${q.series}/${q.difficulty}`;
        dist[key] = (dist[key] || 0) + 1;
    }
    logI('Question distribution', dist);

    state.conflicts = buildConflictGraph(state.allQuestions);

    populateCategories();

    bindOptionButtons('series-buttons', 'series', 'series');
    bindOptionButtons('difficulty-buttons', 'difficulty', 'difficulty');
    bindOptionButtons('count-buttons', 'count', 'count', v => v === 'ALL' ? 'ALL' : parseInt(v, 10));
    bindOptionButtons('type-buttons', 'type', 'type');

    $('category-select').addEventListener('change', e => {
        state.settings.category = e.target.value;
        logI(`category set to: ${state.settings.category}`);
        updatePoolInfo();
    });

    $('start-btn').addEventListener('click', startQuiz);
    $('next-btn').addEventListener('click', nextQuestion);
    $('quit-btn').addEventListener('click', quitToResults);
    $('play-again-btn').addEventListener('click', () => {
        logI('Play again clicked, returning to setup');
        show('setup-screen');
        updatePoolInfo();
    });

    updatePoolInfo();
    logI('Init complete');
}

function populateCategories() {
    const cats = new Set();
    for (const q of state.allQuestions) cats.add(q.category);
    const select = $('category-select');
    Array.from(cats).sort().forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        select.appendChild(opt);
    });
    logI(`Populated ${cats.size} categories`);
}

function bindOptionButtons(containerId, datasetKey, settingKey, transform) {
    const buttons = $(containerId).querySelectorAll('.opt-btn');
    transform = transform || (v => v);
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const raw = btn.dataset[datasetKey];
            state.settings[settingKey] = transform(raw);
            logI(`${settingKey} set to: ${state.settings[settingKey]}`);
            updatePoolInfo();
        });
    });
}

function applyFilters(pool) {
    if (state.settings.series !== 'ALL') {
        pool = pool.filter(q => q.series === state.settings.series);
    }
    if (state.settings.difficulty !== 'ALL') {
        pool = pool.filter(q => q.difficulty === state.settings.difficulty);
    }
    if (state.settings.category !== 'ALL') {
        pool = pool.filter(q => q.category === state.settings.category);
    }
    if (state.settings.type !== 'ALL') {
        pool = pool.filter(q => q.type === state.settings.type);
    }
    return pool;
}

function updatePoolInfo() {
    const pool = applyFilters(state.allQuestions.slice());
    const n = state.settings.count === 'ALL'
        ? pool.length
        : Math.min(state.settings.count, pool.length);
    $('pool-info').textContent = `${pool.length} question(s) match — will play ${n}`;
    logD(`Pool size: ${pool.length}, will play: ${n}`);
}

// ---------- QUIZ FLOW ----------
function startQuiz() {
    logI('=== Starting quiz ===', state.settings);

    let pool = applyFilters(state.allQuestions.slice());
    logI(`After filters: ${pool.length} questions available`);

    if (pool.length === 0) {
        logW('No questions match filters');
        alert('No questions match those filters. Try broader settings.');
        return;
    }

    pool = shuffle(pool);
    const n = state.settings.count === 'ALL'
        ? pool.length
        : Math.min(state.settings.count, pool.length);
    // Greedily pick n questions with no intra-session answer leakage.
    state.questions = selectNonConflicting(pool, n);
    state.currentIndex = 0;
    state.score = 0;
    state.answers = [];
    state.selectedAnswer = null;

    logI(`Quiz armed: ${state.questions.length} questions`);
    show('quiz-screen');
    renderQuestion();
}

function renderQuestion() {
    const q = state.questions[state.currentIndex];
    logI(`Rendering question ${state.currentIndex + 1}/${state.questions.length}: ${q.id}`, {
        category: q.category, difficulty: q.difficulty, type: q.type
    });

    $('progress').textContent = `Question ${state.currentIndex + 1} of ${state.questions.length}`;
    $('score').textContent = `Score: ${state.score}`;

    $('series-badge').textContent = q.series;
    $('series-badge').className = `badge series-${q.series}`;
    $('difficulty-badge').textContent = q.difficulty.toUpperCase();
    $('difficulty-badge').className = `badge difficulty-${q.difficulty}`;
    $('category-badge').textContent = q.category;
    $('category-badge').className = 'badge';
    $('id-badge').textContent = q.id;
    $('id-badge').className = 'badge id-badge';

    $('question-text').textContent = q.question;

    const answersDiv = $('answers');
    answersDiv.innerHTML = '';

    // Preserve True/False ordering; shuffle multiple-choice options.
    const keys = Object.keys(q.answers);
    const orderedKeys = (q.type === 'true_false') ? keys : shuffle(keys);

    orderedKeys.forEach(k => {
        const btn = document.createElement('button');
        btn.className = 'answer-btn';
        btn.dataset.key = k;
        btn.type = 'button';
        const letter = document.createElement('span');
        letter.className = 'answer-letter';
        letter.textContent = k;
        const text = document.createElement('span');
        text.className = 'answer-text';
        text.textContent = q.answers[k];
        btn.appendChild(letter);
        btn.appendChild(text);
        btn.addEventListener('click', () => selectAnswer(k));
        answersDiv.appendChild(btn);
    });

    $('feedback').classList.add('hidden');
    $('feedback').textContent = '';
    $('next-btn').classList.add('hidden');
    state.selectedAnswer = null;
}

function selectAnswer(key) {
    if (state.selectedAnswer !== null) {
        logD('Answer already selected, ignoring click');
        return;
    }
    state.selectedAnswer = key;
    const q = state.questions[state.currentIndex];
    const isCorrect = key === q.correct;

    logI(`Answered ${q.id}: chose ${key}, correct is ${q.correct} -> ${isCorrect ? 'CORRECT' : 'WRONG'}`);
    state.answers.push({ id: q.id, selected: key, correct: q.correct, isCorrect });
    if (isCorrect) state.score++;

    document.querySelectorAll('.answer-btn').forEach(btn => {
        btn.disabled = true;
        const k = btn.dataset.key;
        if (k === q.correct) btn.classList.add('correct');
        if (k === key && !isCorrect) btn.classList.add('wrong');
    });

    const fb = $('feedback');
    fb.classList.remove('hidden');
    fb.classList.toggle('correct', isCorrect);
    fb.classList.toggle('wrong', !isCorrect);

    // Clear previous content
    fb.innerHTML = '';

    const headline = document.createElement('div');
    headline.className = 'feedback-headline';
    headline.textContent = isCorrect
        ? 'CORRECT!'
        : `WRONG — Correct: ${q.correct}. ${q.answers[q.correct]}`;
    fb.appendChild(headline);

    if (q.explanation) {
        const exp = document.createElement('div');
        exp.className = 'feedback-explanation';
        exp.textContent = q.explanation;
        fb.appendChild(exp);
    }

    $('score').textContent = `Score: ${state.score}`;
    const nextBtn = $('next-btn');
    nextBtn.classList.remove('hidden');
    nextBtn.textContent = (state.currentIndex === state.questions.length - 1) ? 'FINISH' : 'NEXT';
}

function nextQuestion() {
    state.currentIndex++;
    if (state.currentIndex >= state.questions.length) {
        showResults();
    } else {
        renderQuestion();
    }
}

function quitToResults() {
    if (state.answers.length === 0) {
        logI('Quit pressed with no answers, returning to setup');
        show('setup-screen');
        return;
    }
    if (confirm('Quit and see your results so far?')) {
        logI('User quit early', { answered: state.answers.length, total: state.questions.length });
        // Trim unanswered questions from the run
        state.questions = state.questions.slice(0, state.answers.length);
        showResults();
    }
}

function showResults() {
    logI('=== Quiz complete ===', { score: state.score, total: state.questions.length });
    show('results-screen');

    const pct = state.questions.length === 0
        ? 0
        : Math.round((state.score / state.questions.length) * 100);

    $('final-score').textContent = `${state.score} / ${state.questions.length}`;
    $('percentage').textContent = `${pct}%`;

    let rank;
    if (pct === 100)      rank = 'ADMIRAL — Live long and prosper.';
    else if (pct >= 90)   rank = 'CAPTAIN — Make it so.';
    else if (pct >= 75)   rank = 'COMMANDER — Solid work, Number One.';
    else if (pct >= 60)   rank = 'LIEUTENANT — Adequate, Ensign.';
    else if (pct >= 40)   rank = 'ENSIGN — More study required.';
    else                  rank = 'CADET — Report back to the Academy.';
    $('rank-title').textContent = rank;
    logI(`Rank: ${rank}`);

    // Category breakdown
    const cats = {};
    state.answers.forEach((a, i) => {
        const q = state.questions[i];
        if (!cats[q.category]) cats[q.category] = { right: 0, total: 0 };
        cats[q.category].total++;
        if (a.isCorrect) cats[q.category].right++;
    });
    const cbDiv = $('category-breakdown');
    cbDiv.innerHTML = '';
    Object.keys(cats).sort().forEach(c => {
        const row = document.createElement('div');
        row.className = 'cat-row';
        const name = document.createElement('span');
        name.className = 'cat-name';
        name.textContent = c;
        const score = document.createElement('span');
        score.className = 'cat-score';
        const sub = cats[c];
        score.textContent = `${sub.right}/${sub.total} (${Math.round(sub.right / sub.total * 100)}%)`;
        row.appendChild(name);
        row.appendChild(score);
        cbDiv.appendChild(row);
    });
    logI('Category breakdown', cats);

    // Missed
    const missedDiv = $('missed-list');
    missedDiv.innerHTML = '';
    const missed = state.answers
        .map((a, i) => ({ a, q: state.questions[i] }))
        .filter(x => !x.a.isCorrect);

    if (missed.length === 0) {
        const ok = document.createElement('div');
        ok.className = 'no-missed';
        ok.textContent = 'PERFECT SCORE — NO MISSED QUESTIONS';
        missedDiv.appendChild(ok);
    } else {
        missed.forEach(({ a, q }) => {
            const div = document.createElement('div');
            div.className = 'missed-q';

            const header = document.createElement('div');
            header.className = 'missed-header';
            header.textContent = `[${q.id}] ${q.question}`;
            div.appendChild(header);

            const yours = document.createElement('div');
            yours.className = 'missed-yours';
            yours.textContent = `Your answer: ${a.selected}. ${q.answers[a.selected]}`;
            div.appendChild(yours);

            const right = document.createElement('div');
            right.className = 'missed-correct';
            right.textContent = `Correct:    ${a.correct}. ${q.answers[a.correct]}`;
            div.appendChild(right);

            if (q.explanation) {
                const exp = document.createElement('div');
                exp.className = 'missed-explanation';
                exp.textContent = q.explanation;
                div.appendChild(exp);
            }

            missedDiv.appendChild(div);
        });
    }

    logI(`Missed ${missed.length} question(s)`);
}

// ---------- BOOT ----------
// Guard for non-browser contexts (e.g. the Node test runner requires this file
// as a module; there is no `document` there).
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', init);
}

// ---------- TEST EXPORTS ----------
// Expose the pure logic so tests can exercise the SAME code the browser runs,
// with no risk of a re-implemented copy drifting out of sync. This block is a
// no-op in the browser (no CommonJS `module`).
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        state,
        SPOILER_MIN_LEN,
        SPOILER_FREQ_MAX,
        shuffle,
        normalizeText,
        buildConflictGraph,
        selectNonConflicting
    };
}
