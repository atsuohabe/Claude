/**
 * vocab.js - 単語データローダー・フィルター
 * TOCFL レベル別 JSON の遅延読み込みと単語クエリを担当する
 */

import { Store } from './store.js';

// ─── データキャッシュ ────────────────────────────────────────────────

let wordsMap = {};     // id → word object
let loadedChunks = new Set();

// TOCFL レベル別チャンクファイル
const CHUNK_FILES = {
  novice1: './data/vocab-novice1.json',
  novice2: './data/vocab-novice2.json',
  level1:  './data/vocab-level1.json',
  level2:  './data/vocab-level2.json',
  level3:  './data/vocab-level3.json',
  level4:  './data/vocab-level4.json',
  level5:  './data/vocab-level5.json',
};

// studyLevel → 必要チャンク名
const LEVEL_CHUNKS = {
  novice1: ['novice1'],
  novice2: ['novice2'],
  level1:  ['level1'],
  level2:  ['level2'],
  level3:  ['level3'],
  level4:  ['level4'],
  level5:  ['level5'],
  all:     ['novice1', 'novice2', 'level1', 'level2', 'level3', 'level4', 'level5'],
};

// ─── 読み込み ────────────────────────────────────────────────────────

export const Vocab = {
  /**
   * studyLevel に必要なチャンクをロード
   * @param {string} studyLevel
   */
  async loadForLevel(studyLevel) {
    const chunks = LEVEL_CHUNKS[studyLevel] || LEVEL_CHUNKS.all;
    await Promise.all(chunks.map(name => _loadChunk(name)));
  },

  /**
   * studyLevel='all' の段階的ロード
   * まず基本レベル (1-4) をロード → 残り (5-7) をバックグラウンドで追加
   */
  async loadAllProgressive() {
    // Phase 1: levels 1-4 (587 KB, 1,226語) — 起動をブロック
    await Promise.all([
      _loadChunk('novice1'),
      _loadChunk('novice2'),
      _loadChunk('level1'),
      _loadChunk('level2'),
    ]);

    // Phase 2: levels 5-7 (2,970 KB, 6,291語) — バックグラウンド
    _loadChunk('level3')
      .then(() => _loadChunk('level4'))
      .then(() => _loadChunk('level5'))
      .then(() => {
        window.dispatchEvent(new CustomEvent('vocab-loaded'));
      });
  },

  /** 全単語を一括ロード（後方互換） */
  async loadAll() {
    await Promise.all(
      Object.keys(CHUNK_FILES).map(name => _loadChunk(name))
    );
  },

  /** 指定 studyLevel の全チャンクがロード済みか */
  isLevelReady(studyLevel) {
    const chunks = LEVEL_CHUNKS[studyLevel] || LEVEL_CHUNKS.all;
    return chunks.every(name => loadedChunks.has(name));
  },

  // ─── クエリ ────────────────────────────────────────────────────

  /** 全単語を frequency_rank 順に返す */
  getAllWords() {
    return Object.values(wordsMap).sort(
      (a, b) => (a.frequency_rank || a.id) - (b.frequency_rank || b.id)
    );
  },

  /** 全単語の ID 一覧を frequency_rank 順に返す */
  getAllWordIds() {
    return this.getAllWords().map(w => w.id);
  },

  /** ID で単語を取得 */
  getWord(id) {
    return wordsMap[id] || null;
  },

  /** TOCFLレベルでフィルタ */
  getByTocflLevel(level) {
    return Object.values(wordsMap)
      .filter(w => w.tocfl_level === level)
      .sort((a, b) => (a.frequency_rank || a.id) - (b.frequency_rank || b.id));
  },

  /**
   * studyLevel 設定に基づいてフィルタした単語一覧を返す
   */
  getFilteredWords(studyLevel) {
    if (!studyLevel || studyLevel === 'all') return this.getAllWords();
    if (studyLevel === 'novice1') return this.getByTocflLevel(1);
    if (studyLevel === 'novice2') return this.getByTocflLevel(2);
    if (studyLevel === 'level1')  return this.getByTocflLevel(3);
    if (studyLevel === 'level2')  return this.getByTocflLevel(4);
    if (studyLevel === 'level3')  return this.getByTocflLevel(5);
    if (studyLevel === 'level4')  return this.getByTocflLevel(6);
    if (studyLevel === 'level5')  return this.getByTocflLevel(7);
    return this.getAllWords();
  },

  /** studyLevel 設定に基づいた単語 ID 一覧 */
  getFilteredWordIds(studyLevel) {
    return this.getFilteredWords(studyLevel).map(w => w.id);
  },

  /**
   * フルテキスト検索（漢字・ピンイン・日本語意味）
   */
  search(query) {
    if (!query) return [];
    const q = query.toLowerCase();
    return Object.values(wordsMap).filter(w =>
      w.hanzi.includes(q) ||
      w.pinyin.toLowerCase().includes(q) ||
      (w.meaning_ja && w.meaning_ja.includes(q)) ||
      (w.meaning_en && w.meaning_en.toLowerCase().includes(q))
    );
  },

  /**
   * SRS データを付与した単語オブジェクトを返す
   */
  getWordWithSRS(wordId) {
    const word = this.getWord(wordId);
    if (!word) return null;
    const srs = Store.getCard(String(wordId));
    return { ...word, srs };
  },

  /** ロード済みの単語数を返す */
  getLoadedCount() {
    return Object.keys(wordsMap).length;
  },
};

// ─── プライベート ────────────────────────────────────────────────────

async function _loadChunk(name) {
  if (loadedChunks.has(name)) return;
  const url = CHUNK_FILES[name];
  if (!url) return;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
    const data = await resp.json();
    const words = Array.isArray(data) ? data : data.words || [];
    for (const word of words) {
      wordsMap[word.id] = word;
    }
    loadedChunks.add(name);
  } catch (e) {
    console.error(`Failed to load vocab chunk "${name}":`, e);
  }
}
