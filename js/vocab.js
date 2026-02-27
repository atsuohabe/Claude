/**
 * vocab.js - 単語データローダー・フィルター
 * JSON ファイルの遅延読み込みと単語クエリを担当する
 */

import { Store } from './store.js';

// ─── データキャッシュ ────────────────────────────────────────────────

let wordsMap = {};     // id → word object
let categories = [];
let loadedChunks = new Set();

const CHUNK_FILES = {
  core: './data/vocab-core.json',
  everyday: './data/vocab-everyday.json',
  advanced: './data/vocab-advanced.json',
};

// ─── 読み込み ────────────────────────────────────────────────────────

export const Vocab = {
  /** コア語彙（1-300）をロード */
  async loadCore() {
    await _loadChunk('core');
    await _loadCategories();
  },

  /** 日常語彙（301-600）をロード */
  async loadEveryday() {
    await _loadChunk('everyday');
  },

  /** 上級語彙（601-1000）をロード */
  async loadAdvanced() {
    await _loadChunk('advanced');
  },

  /** 全単語をロード */
  async loadAll() {
    await Promise.all([
      _loadChunk('core'),
      _loadChunk('everyday'),
      _loadChunk('advanced'),
      _loadCategories(),
    ]);
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

  /** カテゴリでフィルタ */
  getByCategory(categoryId) {
    return Object.values(wordsMap)
      .filter(w => w.category === categoryId)
      .sort((a, b) => (a.frequency_rank || a.id) - (b.frequency_rank || b.id));
  },

  /** 難易度でフィルタ（1=初級, 2=中級, 3=上級） */
  getByDifficulty(level) {
    return Object.values(wordsMap).filter(w => w.difficulty === level);
  },

  /** TOCFLレベルでフィルタ（1=Novice1, 2=Novice2, 3=入門級, 4=基礎級, 5=進階級, 6=高階級, 7=流利級） */
  getByTocflLevel(level) {
    return Object.values(wordsMap)
      .filter(w => w.tocfl_level === level)
      .sort((a, b) => (a.frequency_rank || a.id) - (b.frequency_rank || b.id));
  },

  /**
   * studyLevel 設定に基づいてフィルタした単語一覧を返す
   * @param {'all'|'novice1'|'novice2'|'level1'|'level2'|'level3'|'level4'|'level5'} studyLevel
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

  /** 台湾特有語彙のみ */
  getTaiwanSpecific() {
    return Object.values(wordsMap).filter(w => w.taiwan_specific);
  },

  /**
   * フルテキスト検索（漢字・ピンイン・日本語意味）
   * @param {string} query
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
   * @param {number} wordId
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
  try {
    const resp = await fetch(url, { cache: 'force-cache' });
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

async function _loadCategories() {
  if (categories.length > 0) return;
  try {
    const resp = await fetch('./data/categories.json', { cache: 'force-cache' });
    if (!resp.ok) return;
    const data = await resp.json();
    categories = data.categories || [];
  } catch (e) {
    console.error('Failed to load categories:', e);
  }
}
