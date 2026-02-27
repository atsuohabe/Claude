/**
 * session.js - 学習セッション管理
 * カードキューの管理、評価の処理、セッション統計を担当する
 */

import { Store } from './store.js';
import { Vocab } from './vocab.js';
import {
  calculateNextReviewSimple,
  getDueCardIds,
  getNewCardIds,
  newCardData,
} from './srs.js';

// ─── セッション状態 ───────────────────────────────────────────────────

let _queue = [];           // { wordId, srsData, isNew }[]
let _currentIndex = 0;
let _history = [];         // { wordId, rating, srsData }[]
let _sessionStats = {
  reviewed: 0,
  correct: 0,
  newCards: 0,
  startTime: null,
};
let _pendingUpdates = {};  // wordId → 更新済み SRS データ（まとめて保存）
let _lastSessionWordIds = []; // 直前のセッションで学習した単語 ID

// ─── セッション API ───────────────────────────────────────────────────

export const Session = {
  /**
   * 新しい学習セッションを開始する
   * @param {{ dailyNewLimit?: number, studyLevel?: string }} options
   * @returns {boolean} セッションを開始できたか
   */
  async start(options = {}) {
    const settings = Store.getSettings();
    const dailyNewLimit = options.dailyNewLimit ?? settings.dailyNewLimit ?? 10;

    // 今日導入済みの新規カード数を確認
    const todayNewCount = _getTodayNewCount();
    const remainingNew = Math.max(0, dailyNewLimit - todayNewCount);

    // Due カードを取得
    let dueIds = getDueCardIds(200);

    // 新規カードを取得（studyLevel でフィルタ）
    const studyLevel = options.studyLevel ?? settings.studyLevel ?? 'all';
    let allWordIds = Vocab.getFilteredWordIds(studyLevel);

    // studyLevel に基づいて due カードもフィルタ
    if (studyLevel !== 'all') {
      const filteredSet = new Set(allWordIds.map(String));
      dueIds = dueIds.filter(id => filteredSet.has(String(id)));
    }

    const cardOrder = settings.cardOrder || 'sequential';
    const newIds = _selectNewCards(allWordIds, remainingNew, cardOrder, studyLevel);

    // キューを構築（復習 → 新規を散りばめる）
    _queue = _buildQueue(dueIds, newIds);
    _lastSessionWordIds = [...new Set(_queue.map(item => item.wordId))];
    _currentIndex = 0;
    _history = [];
    _pendingUpdates = {};
    _sessionStats = {
      reviewed: 0,
      correct: 0,
      newCards: 0,
      startTime: Date.now(),
    };

    return _queue.length > 0;
  },

  /** 現在のカードデータ（単語 + SRS）を返す */
  getCurrentCard() {
    if (_currentIndex >= _queue.length) return null;
    const item = _queue[_currentIndex];
    const word = Vocab.getWord(item.wordId);
    if (!word) return null;
    return { word, srsData: item.srsData, isNew: item.isNew };
  },

  /** キューの残り枚数 */
  getRemainingCount() {
    return Math.max(0, _queue.length - _currentIndex);
  },

  /** セッション全体のカード数 */
  getTotalCount() {
    return _queue.length;
  },

  /** セッション完了かどうか */
  isComplete() {
    return _currentIndex >= _queue.length;
  },

  /**
   * 評価を送信して次のカードへ進む
   * @param {'remembered'|'not-yet'} rating
   */
  submitRating(rating) {
    if (this.isComplete()) return;

    const item = _queue[_currentIndex];

    if (rating === 'not-yet') {
      // まだまだ：キュー末尾に再追加（回数制限なし）
      _queue.push({
        ...item,
        isNew: false,
        attemptCount: (item.attemptCount || 0) + 1,
      });
      _currentIndex++;
      _sessionStats.reviewed++;
      return;
    }

    // 覚えた：試行回数ベースで SRS 計算して保存
    const attempts = (item.attemptCount || 0) + 1;
    const updatedSRS = calculateNextReviewSimple(item.srsData, attempts);

    _history.push({ wordId: item.wordId, rating, srsData: updatedSRS });
    _pendingUpdates[String(item.wordId)] = updatedSRS;

    _sessionStats.reviewed++;
    _sessionStats.correct++;
    if (item.isNew) _sessionStats.newCards++;

    _currentIndex++;

    // 定期的に保存（5枚ごと）
    if (_sessionStats.reviewed % 5 === 0) {
      this._flushUpdates();
    }
  },

  /** 1つ前のカード（「覚えた」と記録したもの）に戻る */
  undo() {
    if (_history.length === 0 || _currentIndex === 0) return false;

    _currentIndex--;
    const last = _history.pop();

    // 直前の SRS 状態に戻す
    _queue[_currentIndex].srsData = Store.getCard(String(last.wordId)) || _queue[_currentIndex].srsData;
    _queue[_currentIndex].attemptCount = 0;
    delete _pendingUpdates[String(last.wordId)];

    // 統計修正
    _sessionStats.reviewed = Math.max(0, _sessionStats.reviewed - 1);

    return true;
  },

  /** 直前のセッションで学習した単語 ID リストを返す */
  getLastSessionWordIds() {
    return [..._lastSessionWordIds];
  },

  /**
   * 指定した単語 ID リストでセッションを開始する（SRS due 状態を無視）
   * @param {number[]} wordIds
   * @returns {boolean}
   */
  async startWithIds(wordIds) {
    const allCards = Store.getAllCards();
    _queue = wordIds.map(id => {
      const srsData = allCards[String(id)] || newCardData(Number(id));
      return { wordId: Number(id), srsData, isNew: false };
    });
    _lastSessionWordIds = [...wordIds];
    _currentIndex = 0;
    _history = [];
    _pendingUpdates = {};
    _sessionStats = {
      reviewed: 0,
      correct: 0,
      newCards: 0,
      startTime: Date.now(),
    };
    return _queue.length > 0;
  },

  /** セッションを終了し、保留中の更新を全て保存する */
  end() {
    this._flushUpdates();

    const durationMs = Date.now() - (_sessionStats.startTime || Date.now());
    Store.recordSession({
      date: new Date().toISOString(),
      reviewed: _sessionStats.reviewed,
      correct: _sessionStats.correct,
      newCards: _sessionStats.newCards,
      timeMs: durationMs,
    });

    return this.getSessionStats();
  },

  /** 現在のセッション統計を返す */
  getSessionStats() {
    const durationMs = Date.now() - (_sessionStats.startTime || Date.now());
    const retention = _sessionStats.reviewed > 0
      ? Math.round((_sessionStats.correct / _sessionStats.reviewed) * 100)
      : 0;
    return {
      reviewed: _sessionStats.reviewed,
      correct: _sessionStats.correct,
      newCards: _sessionStats.newCards,
      retention,
      durationMs,
      durationMin: Math.round(durationMs / 60000),
    };
  },

  /** 保留中の SRS 更新を LocalStorage へ書き込む */
  _flushUpdates() {
    if (Object.keys(_pendingUpdates).length === 0) return;
    Store.setCards(_pendingUpdates);
    _pendingUpdates = {};
  },
};

// ─── プライベートヘルパー ─────────────────────────────────────────────

/**
 * 復習カードと新規カードを混ぜてキューを構築する
 * 復習カードを優先し、新規カードを均等に散りばめる
 */
function _shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function _buildQueue(dueIds, newIds) {
  const queue = [];
  const allCards = Store.getAllCards();

  // 復習カードをランダム順に並べる
  const shuffledDueIds = _shuffle([...dueIds]);

  // 復習カード
  for (const id of shuffledDueIds) {
    const srsData = allCards[String(id)] || newCardData(Number(id));
    queue.push({ wordId: Number(id), srsData, isNew: false });
  }

  // 新規カード（SRS データを初期化）
  for (const id of newIds) {
    const srsData = newCardData(id);
    queue.push({ wordId: id, srsData, isNew: true });
  }

  // 新規カードを均等に分散（最初の復習10枚の後に挿入）
  if (newIds.length > 0 && shuffledDueIds.length > 0) {
    const newItems = queue.splice(shuffledDueIds.length); // 新規を一旦取り出す
    const step = Math.max(3, Math.floor(shuffledDueIds.length / newIds.length));
    for (let i = 0; i < newItems.length; i++) {
      const insertAt = Math.min(step * (i + 1), queue.length);
      queue.splice(insertAt + i, 0, newItems[i]);
    }
  }

  return queue;
}

/**
 * cardOrder 設定に従って新規カード ID を選択する
 * random + all レベルの場合は最も低い tocfl_level から選ぶ
 */
function _selectNewCards(allWordIds, limit, cardOrder, studyLevel) {
  const allCards = Store.getAllCards();
  const unseenIds = allWordIds.filter(id => !allCards[String(id)]);

  if (cardOrder !== 'random') {
    return unseenIds.slice(0, limit);
  }

  // ランダムモード
  if (studyLevel !== 'all') {
    return _shuffle([...unseenIds]).slice(0, limit);
  }

  // 全体 + ランダム: 最低の tocfl_level から選ぶ（一巡したら上のレベルへ）
  for (let lvl = 1; lvl <= 7; lvl++) {
    const lvlUnseen = unseenIds.filter(id => {
      const word = Vocab.getWord(id);
      return word && word.tocfl_level === lvl;
    });
    if (lvlUnseen.length > 0) {
      return _shuffle([...lvlUnseen]).slice(0, limit);
    }
  }
  return _shuffle([...unseenIds]).slice(0, limit);
}

/** 今日の新規カード導入数を記録から取得 */
function _getTodayNewCount() {
  const history = Store.getHistory();
  const today = new Date().toDateString();
  const todayRecords = history.filter(
    r => new Date(r.date).toDateString() === today
  );
  return todayRecords.reduce((sum, r) => sum + (r.newCards || 0), 0);
}
