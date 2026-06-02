'use strict';

// Shared test helpers: locate and load the trivia data and the generated bundle.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const SERIES_FILES = [
    { series: 'TOS', file: 'tos_trivia.json' },
    { series: 'TNG', file: 'tng_trivia.json' },
    { series: 'DS9', file: 'ds9_trivia.json' },
    { series: 'VOY', file: 'voy_trivia.json' }
];

const VALID_CATEGORIES = [
    'Alien Species & Cultures',
    'Characters & Crew',
    'Crossovers & Connections',
    'Episodes & Story Arcs',
    'Planets & Locations',
    'Quotes & Catchphrases',
    'Ships & Technology',
    'Starfleet Ranks & Protocol',
    'Timeline & History',
    'Villains & Antagonists'
];

function loadSeries(file) {
    const raw = fs.readFileSync(path.join(ROOT, file), 'utf8');
    return JSON.parse(raw);
}

// Concatenate the four source files in the SAME order build_data.ps1 uses.
function loadAllQuestions() {
    const all = [];
    for (const { file } of SERIES_FILES) {
        for (const q of loadSeries(file)) all.push(q);
    }
    return all;
}

// Parse the array baked into data.js (window.TRIVIA_DATA = [...];).
function loadBundledData() {
    const raw = fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8');
    const marker = 'window.TRIVIA_DATA =';
    const start = raw.indexOf(marker);
    if (start === -1) throw new Error('data.js: TRIVIA_DATA assignment not found');
    let body = raw.slice(start + marker.length).trim();
    if (body.endsWith(';')) body = body.slice(0, -1).trim();
    return JSON.parse(body);
}

module.exports = {
    ROOT,
    SERIES_FILES,
    VALID_CATEGORIES,
    loadSeries,
    loadAllQuestions,
    loadBundledData
};
