/**
 * store.js - LocalStorage 抽象化レイヤー
 * 全モジュールのデータ永続化を担当する
 */

const KEYS = {
  CARDS: 'cmf_cards',
  SETTINGS: 'cmf_settings',
  HISTORY: 'cmf_history',
  STREAK: 'cmf_streak',
  VERSION: 'cmf_version',
};

const SCHEMA_VERSION = 1;

const DEFAULT_SETTINGS = {
  dailyNewLimit: 10,
  theme: 'auto',        // 'auto' | 'light' | 'dark'
  showPinyinOnFront: false,
  autoplayAudio: false,
  ttsRate: 0.8,         // 読み上げ速度（0.5〜1.5）
  studyLevel: 'all',   // 'all' | 'novice1' | 'novice2' | 'level1' | 'level2' | 'level3' | 'level4' | 'level5'
};

export const Store = {
  /** 初期化：スキーマバージョンチェック */
  init() {
    const version = this._get(KEYS.VERSION);
    if (!version) {
      this._set(KEYS.VERSION, SCHEMA_VERSION);
    }
  },

  // ─── カード SRS データ ───────────────────────────────────────────

  /** 指定 ID のカードデータを取得 */
  getCard(id) {
    const cards = this._getCards();
    return cards[id] || null;
  },

  /** カードデータを保存 */
  setCard(id, data) {
    const cards = this._getCards();
    cards[id] = { ...data, updatedAt: new Date().toISOString() };
    this._set(KEYS.CARDS, cards);
  },

  /** 全カードデータを取得 */
  getAllCards() {
    return this._getCards();
  },

  /** 複数カードを一括保存（セッション終了時） */
  setCards(cardMap) {
    const cards = this._getCards();
    const now = new Date().toISOString();
    for (const [id, data] of Object.entries(cardMap)) {
      cards[id] = { ...data, updatedAt: now };
    }
    this._set(KEYS.CARDS, cards);
  },

  // ─── 設定 ────────────────────────────────────────────────────────

  getSettings() {
    return { ...DEFAULT_SETTINGS, ...this._get(KEYS.SETTINGS) };
  },

  updateSettings(patch) {
    const current = this.getSettings();
    this._set(KEYS.SETTINGS, { ...current, ...patch });
  },

  // ─── 学習履歴 ────────────────────────────────────────────────────

  /**
   * セッション記録を追加
   * @param {{ date: string, reviewed: number, correct: number, newCards: number, timeMs: number }} record
   */
  recordSession(record) {
    const history = this.getHistory();
    history.push({ ...record, date: record.date || new Date().toISOString() });
    // 最大365日分だけ保持
    const maxDays = 365;
    if (history.length > maxDays) history.splice(0, history.length - maxDays);
    this._set(KEYS.HISTORY, history);
    this._updateStreak();
  },

  getHistory() {
    return this._get(KEYS.HISTORY) || [];
  },

  // ─── ストリーク ──────────────────────────────────────────────────

  getStreak() {
    return this._get(KEYS.STREAK) || { current: 0, longest: 0, lastStudyDate: null };
  },

  _updateStreak() {
    const today = new Date().toDateString();
    const streak = this.getStreak();

    if (streak.lastStudyDate === today) return; // 既に今日記録済み

    const yesterday = new Date(Date.now() - 86400000).toDateString();
    if (streak.lastStudyDate === yesterday) {
      streak.current += 1;
    } else {
      streak.current = 1;
    }
    streak.longest = Math.max(streak.longest, streak.current);
    streak.lastStudyDate = today;
    this._set(KEYS.STREAK, streak);
  },

  // ─── エクスポート / インポート ───────────────────────────────────

  exportProgress() {
    return JSON.stringify({
      version: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      cards: this._getCards(),
      settings: this.getSettings(),
      history: this.getHistory(),
      streak: this.getStreak(),
    }, null, 2);
  },

  importProgress(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (!data.cards) throw new Error('Invalid backup file');
      this._set(KEYS.CARDS, data.cards);
      if (data.settings) this._set(KEYS.SETTINGS, data.settings);
      if (data.history) this._set(KEYS.HISTORY, data.history);
      if (data.streak) this._set(KEYS.STREAK, data.streak);
      return true;
    } catch (e) {
      console.error('Import failed:', e);
      return false;
    }
  },

  resetAll() {
    for (const key of Object.values(KEYS)) {
      localStorage.removeItem(key);
    }
    this.init();
  },

  // ─── プライベートヘルパー ─────────────────────────────────────────

  _getCards() {
    return this._get(KEYS.CARDS) || {};
  },

  _get(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error('Store._get error:', key, e);
      return null;
    }
  },

  _set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // QuotaExceededError などを無視せず警告
      console.error('Store._set error (storage quota?):', key, e);
    }
  },
};
