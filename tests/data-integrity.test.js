'use strict';

// Data-integrity tests: assert the four *_trivia.json source files and the
// generated data.js bundle are well-formed and internally consistent.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    SERIES_FILES,
    VALID_CATEGORIES,
    loadSeries,
    loadAllQuestions,
    loadBundledData
} = require('./helpers');

const EXPECTED_PER_SERIES = 150;
const EXPECTED_PER_DIFFICULTY = 50;
const DIFFICULTIES = ['easy', 'medium', 'hard'];

for (const { series, file } of SERIES_FILES) {
    test(`${series}: exactly ${EXPECTED_PER_SERIES} questions with a 50/50/50 difficulty split`, () => {
        const qs = loadSeries(file);
        assert.equal(qs.length, EXPECTED_PER_SERIES, `${file} should have ${EXPECTED_PER_SERIES} questions`);

        const counts = { easy: 0, medium: 0, hard: 0 };
        for (const q of qs) {
            assert.ok(DIFFICULTIES.includes(q.difficulty), `${q.id} has invalid difficulty "${q.difficulty}"`);
            counts[q.difficulty]++;
        }
        for (const d of DIFFICULTIES) {
            assert.equal(counts[d], EXPECTED_PER_DIFFICULTY, `${series} ${d} count`);
        }
    });

    test(`${series}: IDs are sequential SERIES-001..150 and unique`, () => {
        const qs = loadSeries(file);
        const ids = qs.map(q => q.id);
        assert.equal(new Set(ids).size, ids.length, `${series} has duplicate IDs`);
        const expected = Array.from({ length: EXPECTED_PER_SERIES }, (_, i) =>
            `${series}-${String(i + 1).padStart(3, '0')}`);
        assert.deepEqual([...ids].sort(), [...expected].sort(), `${series} ID set mismatch`);
    });

    test(`${series}: no duplicate question text`, () => {
        const qs = loadSeries(file);
        const seen = new Map();
        for (const q of qs) {
            const key = q.question.trim().toLowerCase();
            assert.ok(!seen.has(key), `${q.id} duplicates question text of ${seen.get(key)}`);
            seen.set(key, q.id);
        }
    });

    test(`${series}: every question has a valid, self-consistent schema`, () => {
        const qs = loadSeries(file);
        for (const q of qs) {
            assert.equal(q.series, series, `${q.id} series field should be ${series}`);
            assert.ok(VALID_CATEGORIES.includes(q.category), `${q.id} invalid category "${q.category}"`);
            assert.ok(typeof q.question === 'string' && q.question.trim().length > 0, `${q.id} empty question`);
            assert.ok(typeof q.explanation === 'string' && q.explanation.trim().length > 0, `${q.id} empty explanation`);

            assert.ok(q.answers && typeof q.answers === 'object', `${q.id} missing answers`);
            const keys = Object.keys(q.answers);

            if (q.type === 'true_false') {
                assert.deepEqual([...keys].sort(), ['A', 'B'], `${q.id} true_false must have exactly A and B`);
            } else if (q.type === 'multiple_choice') {
                assert.deepEqual([...keys].sort(), ['A', 'B', 'C', 'D'], `${q.id} multiple_choice must have A-D`);
            } else {
                assert.fail(`${q.id} has unknown type "${q.type}"`);
            }

            for (const k of keys) {
                assert.ok(typeof q.answers[k] === 'string' && q.answers[k].trim().length > 0,
                    `${q.id} answer ${k} is empty`);
            }
            assert.ok(keys.includes(q.correct), `${q.id} correct key "${q.correct}" not among answers`);
        }
    });
}

test('corpus: 600 questions total with globally unique IDs', () => {
    const all = loadAllQuestions();
    assert.equal(all.length, 600, 'expected 600 questions across all four series');
    const ids = all.map(q => q.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate IDs across series');
});

test('data.js is in sync with the source JSON files', () => {
    const bundled = loadBundledData();
    const source = loadAllQuestions();
    assert.equal(bundled.length, source.length, 'data.js length differs from sources — re-run build_data.ps1');
    assert.deepEqual(bundled, source, 'data.js content is stale — re-run build_data.ps1');
});
