'use strict';

// Anti-spoiler tests: exercise the REAL functions exported from app.js against
// the real question corpus, so a regression in the shipped logic fails here.

// Silence app.js's verbose logging so it doesn't drown the test reporter.
console.log = () => {};
console.info = () => {};

const { test } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../app.js');
const { loadAllQuestions } = require('./helpers');

const ALL = loadAllQuestions();
const byId = new Map(ALL.map(q => [q.id, q]));

// A few pairs we manually confirmed are genuine answer leaks. If the heuristic
// stops catching these, that's a real regression.
const KNOWN_LEAK_PAIRS = [
    ['DS9-095', 'DS9-100'],
    ['VOY-019', 'VOY-003'],
    ['DS9-136', 'DS9-042']
];

function buildGraph() {
    return app.buildConflictGraph(ALL);
}

// ---------- normalizeText ----------
test('normalizeText lowercases, strips punctuation, and collapses whitespace', () => {
    assert.equal(app.normalizeText('NCC-74656'), 'ncc 74656');
    assert.equal(app.normalizeText("Qapla'!"), 'qapla');
    assert.equal(app.normalizeText('  The   Dominion   War  '), 'the dominion war');
});

test('normalizeText handles null/undefined safely', () => {
    assert.equal(app.normalizeText(null), '');
    assert.equal(app.normalizeText(undefined), '');
});

// ---------- buildConflictGraph ----------
test('buildConflictGraph returns a Map keyed by question id', () => {
    const g = buildGraph();
    assert.ok(g instanceof Map);
    for (const id of g.keys()) {
        assert.ok(byId.has(id), `graph references unknown id ${id}`);
    }
});

test('conflict graph is symmetric (undirected)', () => {
    const g = buildGraph();
    for (const [a, neighbors] of g) {
        for (const b of neighbors) {
            assert.ok(g.has(b) && g.get(b).has(a), `asymmetric edge: ${a}->${b} but not ${b}->${a}`);
            assert.notEqual(a, b, `${a} is linked to itself`);
        }
    }
});

test('known answer-leak pairs are detected', () => {
    const g = buildGraph();
    for (const [a, b] of KNOWN_LEAK_PAIRS) {
        assert.ok(byId.has(a) && byId.has(b), `fixture pair ${a}/${b} no longer exists`);
        assert.ok(g.has(a) && g.get(a).has(b), `expected leak pair ${a} <-> ${b} not detected`);
    }
});

test('ubiquitous terms do not cause runaway over-linking', () => {
    const g = buildGraph();
    // No single question should conflict with an unreasonable number of others;
    // a blown frequency cap (e.g. linking everything that mentions "Vulcan")
    // would spike this well past any sane value.
    let maxDegree = 0;
    let worst = null;
    for (const [id, neighbors] of g) {
        if (neighbors.size > maxDegree) { maxDegree = neighbors.size; worst = id; }
    }
    assert.ok(maxDegree <= 30, `over-linking: ${worst} conflicts with ${maxDegree} questions`);
});

test('explicit conflictsWith and topic overrides create edges', () => {
    // Build a tiny synthetic corpus to prove the manual override layers work,
    // independent of the text heuristic.
    const synthetic = [
        { id: 'X-1', series: 'X', type: 'true_false', correct: 'A',
          answers: { A: 'True', B: 'False' }, question: 'q1', explanation: 'e1',
          conflictsWith: ['X-2'] },
        { id: 'X-2', series: 'X', type: 'true_false', correct: 'A',
          answers: { A: 'True', B: 'False' }, question: 'q2', explanation: 'e2' },
        { id: 'X-3', series: 'X', type: 'true_false', correct: 'A',
          answers: { A: 'True', B: 'False' }, question: 'q3', explanation: 'e3', topic: 'warp' },
        { id: 'X-4', series: 'X', type: 'true_false', correct: 'A',
          answers: { A: 'True', B: 'False' }, question: 'q4', explanation: 'e4', topic: 'warp' }
    ];
    const g = app.buildConflictGraph(synthetic);
    assert.ok(g.get('X-1').has('X-2') && g.get('X-2').has('X-1'), 'conflictsWith edge missing');
    assert.ok(g.get('X-3').has('X-4') && g.get('X-4').has('X-3'), 'topic-cluster edge missing');
});

// ---------- selectNonConflicting ----------
test('a generated session never contains a conflicting pair (200 randomized runs)', () => {
    const g = buildGraph();
    app.state.conflicts = g;
    const N = 25;
    for (let run = 0; run < 200; run++) {
        const session = app.selectNonConflicting(app.shuffle(ALL), N);
        assert.equal(session.length, N, 'session under-delivered on a large pool');
        for (let i = 0; i < session.length; i++) {
            for (let j = i + 1; j < session.length; j++) {
                const a = session[i].id, b = session[j].id;
                const conflict = g.has(a) && g.get(a).has(b);
                assert.ok(!conflict, `session contained conflicting pair ${a} <-> ${b}`);
            }
        }
    }
});

test('selectNonConflicting delivers exactly N when the pool is large enough', () => {
    app.state.conflicts = buildGraph();
    assert.equal(app.selectNonConflicting(app.shuffle(ALL), 50).length, 50);
});

test('backfill: returns N even when the pool cannot avoid conflicts', () => {
    const g = buildGraph();
    app.state.conflicts = g;
    const [a, b] = KNOWN_LEAK_PAIRS[0];
    const pool = [byId.get(a), byId.get(b)];
    const result = app.selectNonConflicting(pool, 2);
    assert.equal(result.length, 2, 'backfill should still return the requested count');
    assert.deepEqual(result.map(q => q.id).sort(), [a, b].sort());
});

test('selectNonConflicting returns the whole pool when it is smaller than N', () => {
    app.state.conflicts = buildGraph();
    const result = app.selectNonConflicting([byId.get('TOS-001')], 5);
    assert.equal(result.length, 1);
});

test('with no conflicts, selectNonConflicting just takes the first N', () => {
    app.state.conflicts = new Map();
    const pool = ALL.slice(0, 10);
    const result = app.selectNonConflicting(pool, 4);
    assert.deepEqual(result.map(q => q.id), pool.slice(0, 4).map(q => q.id));
});
