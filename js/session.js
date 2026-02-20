/**
 * session.js - 学習セッション管理
 * カードキューの管理、評価の処理、セッション統計を担当する
 */

import { Store } from './store.js';
import { Vocab } from './vocab.js';
import {
  calculateNextReview,
  getDueCardIds,
  getNewCardIds,
  newCardData,
  RATING,
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

// ─── セッション API ───────────────────────────────────────────────────

export const Session = {
  /**
   * 新しい学習セッションを開始する
   * @param {{ categories?: string[], dailyNewLimit?: number }} options
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

    // カテゴリフィルター
    const filterCategories = options.categories?.length > 0
      ? options.categories
      : settings.studyCategories;

    if (filterCategories?.length > 0) {
      dueIds = dueIds.filter(id => {
        const word = Vocab.getWord(Number(id));
        return word && filterCategories.includes(word.category);
      });
    }

    // 新規カードを取得
    let allWordIds = Vocab.getAllWordIds();
    if (filterCategories?.length > 0) {
      allWordIds = allWordIds.filter(id => {
        const word = Vocab.getWord(id);
        return word && filterCategories.includes(word.category);
      });
    }

    const newIds = getNewCardIds(allWordIds, remainingNew);

    // キューを構築（復習 → 新規を散りばめる）
    _queue = _buildQueue(dueIds, newIds);
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
   * @param {number} rating - RATING.AGAIN(0) ～ RATING.EASY(3)
   */
  submitRating(rating) {
    if (this.isComplete()) return;

    const item = _queue[_currentIndex];
    const updatedSRS = calculateNextReview(item.srsData, rating);

    // 履歴に記録
    _history.push({ wordId: item.wordId, rating, srsData: updatedSRS });

    // 保留中の更新に追加
    _pendingUpdates[String(item.wordId)] = updatedSRS;

    // 統計更新
    _sessionStats.reviewed++;
    if (rating >= RATING.HARD) _sessionStats.correct++;
    if (item.isNew) _sessionStats.newCards++;

    // 「もう一度」の場合はキューの後ろへ再追加（最大2回まで）
    if (rating === RATING.AGAIN && (item.againCount || 0) < 2) {
      _queue.push({
        ...item,
        srsData: updatedSRS,
        isNew: false,
        againCount: (item.againCount || 0) + 1,
      });
    }

    _currentIndex++;

    // 定期的に保存（5枚ごと）
    if (_sessionStats.reviewed % 5 === 0) {
      this._flushUpdates();
    }
  },

  /** 1つ前のカードに戻る（undo） */
  undo() {
    if (_history.length === 0 || _currentIndex === 0) return false;

    _currentIndex--;
    const last = _history.pop();

    // 直前の SRS 状態に戻す
    _queue[_currentIndex].srsData = Store.getCard(String(last.wordId)) || _queue[_currentIndex].srsData;
    delete _pendingUpdates[String(last.wordId)];

    // 再追加したカードがあれば除去
    if (last.rating === RATING.AGAIN) {
      // キューの末尾から same wordId の再追加を取り除く
      const lastIdx = _queue.length - 1;
      if (
        lastIdx > _currentIndex &&
        _queue[lastIdx].wordId === last.wordId &&
        _queue[lastIdx].againCount
      ) {
        _queue.pop();
      }
    }

    // 統計修正
    _sessionStats.reviewed = Math.max(0, _sessionStats.reviewed - 1);

    return true;
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
function _buildQueue(dueIds, newIds) {
  const queue = [];
  const allCards = Store.getAllCards();

  // 復習カード
  for (const id of dueIds) {
    const srsData = allCards[String(id)] || newCardData(Number(id));
    queue.push({ wordId: Number(id), srsData, isNew: false });
  }

  // 新規カード（SRS データを初期化）
  for (const id of newIds) {
    const srsData = newCardData(id);
    queue.push({ wordId: id, srsData, isNew: true });
  }

  // 新規カードを均等に分散（最初の復習10枚の後に挿入）
  if (newIds.length > 0 && dueIds.length > 0) {
    const newItems = queue.splice(dueIds.length); // 新規を一旦取り出す
    const step = Math.max(3, Math.floor(dueIds.length / newIds.length));
    for (let i = 0; i < newItems.length; i++) {
      const insertAt = Math.min(step * (i + 1), queue.length);
      queue.splice(insertAt + i, 0, newItems[i]);
    }
  }

  return queue;
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
