/**
 * app.js - アプリ起動・ハッシュルーター・ビュー調整
 * 全モジュールを協調させてアプリを動かす
 */

import { Store } from './store.js';
import { Vocab } from './vocab.js';
import { Session } from './session.js';
import { Flashcard, speakWord } from './flashcard.js';
import { renderStats, getOverview, updateProgressRing } from './stats.js';
import {
  toast,
  checkMilestones,
  setTheme,
  applyStoredTheme,
  renderCategoryFilters,
  ICONS,
  modal,
} from './ui.js';
import {
  getDueCardIds,
  getNewCardIds,
  getMasteredCount,
  getLearningCount,
} from './srs.js';
import { attachKeyboard } from './gestures.js';

// ─── DOM 参照 ────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

// ─── アプリ起動 ──────────────────────────────────────────────────────

async function init() {
  Store.init();
  applyStoredTheme();
  buildNav();

  // 全語彙を一括ロード（レベル別の単語数を正確に表示するため）
  await Vocab.loadAll();

  // ルーター初期化
  window.addEventListener('hashchange', handleRoute);
  handleRoute();

  // Service Worker 登録
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

// ─── ナビゲーション構築 ──────────────────────────────────────────────

function buildNav() {
  const navItems = [
    { hash: '#home',     icon: ICONS.home,     label: 'ホーム' },
    { hash: '#study',    icon: ICONS.study,    label: '学習' },
    { hash: '#browse',   icon: ICONS.browse,   label: '単語帳' },
    { hash: '#stats',    icon: ICONS.stats,    label: '統計' },
    { hash: '#settings', icon: ICONS.settings, label: '設定' },
  ];

  // ボトムナビ（モバイル）
  const navBottom = $('nav-bottom');
  if (navBottom) {
    for (const item of navItems) {
      const btn = document.createElement('button');
      btn.className = 'nav-bottom__item';
      btn.dataset.hash = item.hash;
      btn.innerHTML = `
        <span class="nav-bottom__icon">${item.icon}</span>
        <span>${item.label}</span>
      `;
      btn.addEventListener('click', () => { location.hash = item.hash; });
      navBottom.appendChild(btn);
    }
  }

  // サイドバーナビ（デスクトップ）
  const navSidebar = $('nav-sidebar');
  if (navSidebar) {
    const logoEl = document.createElement('div');
    logoEl.className = 'nav-sidebar__logo';
    logoEl.innerHTML = '台湾華語<br>フラッシュカード';
    navSidebar.appendChild(logoEl);

    const itemsEl = document.createElement('div');
    itemsEl.className = 'nav-sidebar__items';

    for (const item of navItems) {
      const btn = document.createElement('button');
      btn.className = 'nav-sidebar__item';
      btn.dataset.hash = item.hash;
      btn.innerHTML = `
        <span class="nav-sidebar__icon">${item.icon}</span>
        <span>${item.label}</span>
      `;
      btn.addEventListener('click', () => { location.hash = item.hash; });
      itemsEl.appendChild(btn);
    }
    navSidebar.appendChild(itemsEl);
  }
}

function updateNavActive(hash) {
  document.querySelectorAll('[data-hash]').forEach(el => {
    el.classList.toggle('active', el.dataset.hash === hash);
  });
}

// ─── ルーター ────────────────────────────────────────────────────────

let _currentFlashcard = null;
let _keyboardDetach = null;

function handleRoute() {
  const hash = location.hash || '#home';
  const viewId = hash.slice(1); // '#home' → 'home'

  // 全ビューを非表示
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

  // 対象ビューを表示
  const view = $(`view-${viewId}`);
  if (view) view.classList.add('active');

  updateNavActive(hash);

  // キーボードショートカットをリセット
  _keyboardDetach?.detach();
  _keyboardDetach = null;

  // 現在のフラッシュカードを破棄
  if (hash !== '#study' && _currentFlashcard) {
    _currentFlashcard.destroy();
    _currentFlashcard = null;
  }

  switch (viewId) {
    case 'home':    renderHome(); break;
    case 'study':   renderStudySetup(); break;
    case 'browse':  renderBrowse(); break;
    case 'stats':   renderStatsView(); break;
    case 'settings': renderSettings(); break;
    default:        renderHome(); break;
  }
}

// ─── ホーム画面 ──────────────────────────────────────────────────────

function renderHome() {
  const container = $('view-home');
  if (!container) return;

  const overview = getOverview();
  const allCards = Store.getAllCards();
  const dueCount = getDueCardIds(999).length;
  const settings = Store.getSettings();
  const studyLevel = settings.studyLevel || 'all';
  const todayH = new Date().toDateString();
  const todayNewCountH = Store.getHistory()
    .filter(r => new Date(r.date).toDateString() === todayH)
    .reduce((sum, r) => sum + (r.newCards || 0), 0);
  const filteredWordIds = Vocab.getFilteredWordIds(studyLevel);
  const newCount = Math.min(
    Math.max(0, settings.dailyNewLimit - todayNewCountH),
    filteredWordIds.filter(id => !allCards[String(id)]).length
  );

  const levelLabels = { all: '全体', novice1: 'Novice 1', novice2: 'Novice 2', level1: '入門級', level2: '基礎級', level3: '進階級', level4: '高階級', level5: '流利級' };
  const levelLabel = levelLabels[studyLevel] || '全体';
  const filteredTotal = filteredWordIds.length;
  const filteredSeen = filteredWordIds.filter(id => !!allCards[String(id)]).length;
  const totalSeenPct = filteredTotal > 0
    ? Math.round((filteredSeen / filteredTotal) * 100) : 0;

  container.innerHTML = `
    <div class="page">
      <div class="dashboard-hero">
        <div class="dashboard-hero__title">台湾華語フラッシュカード</div>
        <div class="level-badge" id="home-level-badge" title="タップしてレベルを変更">
          ${levelLabel}
        </div>

        <div class="dashboard-hero__ring">
          <svg class="progress-ring" viewBox="0 0 120 120">
            <circle class="progress-ring__bg" cx="60" cy="60" r="52"/>
            <circle class="progress-ring__track--learning" cx="60" cy="60" r="52"/>
            <circle class="progress-ring__track--mastered" cx="60" cy="60" r="52"/>
            <g class="progress-ring__text" transform="translate(60,60) rotate(90)">
              <text class="progress-ring__number" dy="-8" text-anchor="middle">0</text>
              <text class="progress-ring__label" dy="10" text-anchor="middle">/ ${filteredTotal} 語</text>
              <text class="progress-ring__label" dy="24" text-anchor="middle" style="font-size:9px;fill:var(--color-text-muted)">覚えた</text>
            </g>
          </svg>
        </div>

        <div class="queue-row">
          <div class="queue-pill">
            <span class="queue-pill__number">${filteredSeen}</span>
            <span class="queue-pill__label">覚えた</span>
          </div>
          <div class="queue-pill">
            <span class="queue-pill__number">${filteredWordIds.filter(id => (allCards[String(id)]?.interval || 0) >= 21).length}</span>
            <span class="queue-pill__label">習得済み</span>
          </div>
        </div>

        <button class="btn btn--primary btn--lg" id="start-study-btn">
          学習を始める
        </button>
      </div>

      <div class="surface-card" style="margin-top:var(--space-4)">
        <div class="section-title" style="margin-bottom:var(--space-3)">進捗</div>
        <div style="display:flex;justify-content:space-between;font-size:0.8rem;color:var(--color-text-muted);margin-bottom:var(--space-2)">
          <span>覚えた: ${filteredSeen}語 / ${filteredTotal}語</span>
          <span>${totalSeenPct}%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-bar__fill progress-bar__fill--primary" style="width:${totalSeenPct}%"></div>
        </div>
        <div style="display:flex;gap:var(--space-4);margin-top:var(--space-4);font-size:0.75rem;flex-wrap:wrap">
          <span style="display:flex;align-items:center;gap:6px">
            <span style="width:10px;height:10px;border-radius:50%;background:var(--color-text);display:inline-block"></span>
            習得済み: ${overview.mastered}
          </span>
          <span style="display:flex;align-items:center;gap:6px">
            <span style="width:10px;height:10px;border-radius:50%;background:var(--color-text-muted);display:inline-block"></span>
            学習中: ${overview.learning}
          </span>
          <span style="display:flex;align-items:center;gap:6px">
            <span style="width:10px;height:10px;border-radius:50%;background:var(--color-border);display:inline-block"></span>
            未学習: ${overview.notStarted}
          </span>
        </div>
      </div>
    </div>
  `;

  // プログレスリング更新（選択レベルのデータで表示）
  const svg = container.querySelector('.progress-ring');
  if (svg) {
    const filteredMastered = filteredWordIds.filter(id => (allCards[String(id)]?.interval || 0) >= 21).length;
    const filteredLearning = filteredWordIds.filter(id => {
      const c = allCards[String(id)];
      return c && (c.interval || 0) < 21;
    }).length;
    updateProgressRing(svg, {
      mastered: filteredMastered,
      learning: filteredLearning,
      totalSeen: filteredSeen,
      total: filteredTotal,
    });
  }

  // レベルバッジをタップ → 設定ページへ
  container.querySelector('#home-level-badge')?.addEventListener('click', () => {
    location.hash = '#settings';
  });

  // 学習開始ボタン
  container.querySelector('#start-study-btn')?.addEventListener('click', () => {
    location.hash = '#study';
  });
}

// ─── 学習セットアップ → セッション ──────────────────────────────────


async function renderStudySetup() {
  const container = $('view-study');
  if (!container) return;

  const overview = getOverview();
  const dueIds = getDueCardIds(999);
  const allWordIds = Vocab.getAllWordIds();
  const allCards = Store.getAllCards();
  const settings = Store.getSettings();
  const newLimit = settings.dailyNewLimit;

  const newAvailable = allWordIds.filter(id => !allCards[String(id)]).length;
  const filteredWordIds = Vocab.getFilteredWordIds(settings.studyLevel || 'all');
  const filteredNewAvailable = filteredWordIds.filter(id => !allCards[String(id)]).length;
  // 今日すでに導入した新規カード数を引いて、残り枠を正確に計算
  const today = new Date().toDateString();
  const todayNewCount = Store.getHistory()
    .filter(r => new Date(r.date).toDateString() === today)
    .reduce((sum, r) => sum + (r.newCards || 0), 0);
  const remainingNewLimit = Math.max(0, newLimit - todayNewCount);
  const newToday = Math.min(remainingNewLimit, newAvailable);

  container.innerHTML = `
    <div class="page page--study">
      <h1 class="page-title">学習セッション</h1>

      <div class="surface-card" style="margin-bottom:var(--space-4)">
        <div style="display:flex;gap:var(--space-4);margin-bottom:var(--space-4)">
          <div class="stat-tile" style="flex:1">
            <div class="stat-tile__number">${overview.totalSeen}</div>
            <div class="stat-tile__label">覚えた</div>
          </div>
          <div class="stat-tile" style="flex:1">
            <div class="stat-tile__number">${overview.mastered}</div>
            <div class="stat-tile__label">習得済み</div>
          </div>
        </div>

        <button class="btn btn--primary btn--full" id="begin-session-btn">
          ${dueIds.length === 0 && newToday === 0 ? 'ランダムな10枚を復習する' : '学習開始'}
        </button>
        ${dueIds.length === 0 && newToday === 0
          ? '<p class="text-muted text-sm" style="text-align:center;margin-top:var(--space-3)">今日の学習は完了しています。学習済みカードからランダムに10枚を復習します。</p>'
          : ''}
        ${filteredNewAvailable > 0
          ? `<button class="btn btn--outline btn--full" id="learn-new-btn" style="margin-top:var(--space-3)">新しいカードを覚える</button>`
          : ''}
      </div>

      <div class="surface-card surface-card--sm">
        <p class="text-sm text-muted">
          ショートカット: <strong>スペース/Enter</strong> でカードをめくる、
          <strong>1</strong> まだまだ / <strong>2</strong> 覚えた、<strong>Ctrl+Z</strong> で元に戻す
        </p>
      </div>
    </div>
  `;

  // 学習開始ボタン
  container.querySelector('#begin-session-btn')?.addEventListener('click', async () => {
    if (dueIds.length === 0 && newToday === 0) {
      // 今日の分は完了 → 学習済みからランダム10枚を復習
      const allLearnedIds = Object.keys(Store.getAllCards()).map(Number);
      if (allLearnedIds.length === 0) {
        toast('まだ学習したカードがありません。', 'info');
        return;
      }
      const shuffled = [...allLearnedIds].sort(() => Math.random() - 0.5);
      const learnedIds = shuffled.slice(0, 10);
      await startStudySession(container, learnedIds);
    } else {
      await startStudySession(container);
    }
  });

  // 新しいカードを覚えるボタン
  container.querySelector('#learn-new-btn')?.addEventListener('click', async () => {
    const unseenIds = filteredWordIds.filter(id => !Store.getAllCards()[String(id)]);
    if (unseenIds.length === 0) {
      toast('このレベルの未学習カードはありません。', 'info');
      return;
    }
    const batch = unseenIds.slice(0, settings.dailyNewLimit || 10);
    await startStudySession(container, batch);
  });
}

async function startStudySession(container, wordIds = null) {
  const started = wordIds
    ? await Session.startWithIds(wordIds)
    : await Session.start();

  if (!started) {
    toast('学習するカードがありません。明日また来てください！', 'info');
    return;
  }

  // セッション UI を描画
  container.innerHTML = '';

  const flashcardEl = document.createElement('div');
  flashcardEl.className = 'page page--study';
  container.appendChild(flashcardEl);

  _currentFlashcard = new Flashcard(flashcardEl, {
    onRated: (rating) => {
      Session.submitRating(rating);

      if (Session.isComplete()) {
        showSessionComplete(container);
        return;
      }

      const card = Session.getCurrentCard();
      if (card) {
        _currentFlashcard.render(card.word, card.srsData);
        _currentFlashcard.updateProgress(
          Session.getTotalCount() - Session.getRemainingCount(),
          Session.getTotalCount()
        );
        _currentFlashcard.setHeaderRight(
          `<button class="btn btn--ghost btn--sm" id="undo-btn">${ICONS.undo} 戻る</button>`
        );
        container.querySelector('#undo-btn')?.addEventListener('click', handleUndo);

        // マイルストーンチェック
        checkMilestones(getMasteredCount());
      }
    }
  });

  // キーボードショートカット
  _keyboardDetach = attachKeyboard({
    onFlip: () => _currentFlashcard?.flip(),
    onNotYet: () => container.querySelector('.rating-btn--not-yet')?.click(),
    onRemembered: () => container.querySelector('.rating-btn--remembered')?.click(),
    onUndo: () => handleUndo(),
  });

  // 最初のカードを描画
  const card = Session.getCurrentCard();
  if (card) {
    _currentFlashcard.render(card.word, card.srsData);
    _currentFlashcard.updateProgress(0, Session.getTotalCount());
    _currentFlashcard.setHeaderLeft(
      `<button class="btn btn--ghost btn--sm" onclick="history.back()">✕</button>`
    );
    _currentFlashcard.setHeaderRight(
      `<button class="btn btn--ghost btn--sm" id="undo-btn">${ICONS.undo} 戻る</button>`
    );
    container.querySelector('#undo-btn')?.addEventListener('click', handleUndo);
  }
}

function handleUndo() {
  if (Session.undo()) {
    const card = Session.getCurrentCard();
    if (card && _currentFlashcard) {
      _currentFlashcard.render(card.word, card.srsData);
      _currentFlashcard.updateProgress(
        Session.getTotalCount() - Session.getRemainingCount(),
        Session.getTotalCount()
      );
    }
  }
}

function showSessionComplete(container) {
  const lastWordIds = Session.getLastSessionWordIds();
  const stats = Session.end();
  _keyboardDetach?.detach();
  _keyboardDetach = null;

  checkMilestones(getMasteredCount());

  container.innerHTML = `
    <div class="page page--study">
      <div class="session-complete">
        <div class="session-complete__emoji">🎉</div>
        <div class="session-complete__title">セッション完了！</div>
        <p class="text-muted">お疲れ様でした！</p>

        <div class="session-complete__stats">
          <div class="session-complete__stat">
            <div class="session-complete__stat-number">${stats.reviewed}</div>
            <div class="session-complete__stat-label">復習カード</div>
          </div>
          <div class="session-complete__stat">
            <div class="session-complete__stat-number">${stats.retention}%</div>
            <div class="session-complete__stat-label">正解率</div>
          </div>
          <div class="session-complete__stat">
            <div class="session-complete__stat-number">${stats.newCards}</div>
            <div class="session-complete__stat-label">新規語彙</div>
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:var(--space-3);width:100%;max-width:320px">
          <button class="btn btn--secondary btn--lg btn--full" id="review-again-btn">
            もう一度練習する
          </button>
          <button class="btn btn--primary btn--lg btn--full" onclick="location.hash='#home'">
            ホームへ戻る
          </button>
        </div>
      </div>
    </div>
  `;

  container.querySelector('#review-again-btn')?.addEventListener('click', () => {
    startStudySession(container, lastWordIds);
  });
}

// ─── 単語帳（ブラウズ）────────────────────────────────────────────────

let _browseSort = 'rank'; // 'rank' | 'learned' | 'mastered'
let _browseLevel = 'all'; // 'all' | 'novice1' | 'novice2' | 'level1' | 'level2' | 'level3' | 'level4' | 'level5'

function renderBrowse() {
  const container = $('view-browse');
  if (!container) return;

  const allCards = Store.getAllCards();
  let words = Vocab.getFilteredWords(_browseLevel);

  // ソート／フィルター
  const MATURE_INTERVAL = 21;
  if (_browseSort === 'learned') {
    // SRSデータがある単語のみ（覚えたことがある）
    words = words.filter(w => !!allCards[String(w.id)]);
  } else if (_browseSort === 'mastered') {
    // インターバル21日以上（習得済み）のみ
    words = words.filter(w => (allCards[String(w.id)]?.interval || 0) >= MATURE_INTERVAL);
  }

  const sortLabels = { rank: '頻度順', learned: '覚えた順', mastered: '習得順' };
  const levelLabels = { all: '全体', novice1: 'Novice 1', novice2: 'Novice 2', level1: '入門級', level2: '基礎級', level3: '進階級', level4: '高階級', level5: '流利級' };

  // 件数ラベル
  let countLabel;
  if (_browseSort === 'learned') {
    countLabel = `覚えた単語: ${words.length}語`;
  } else if (_browseSort === 'mastered') {
    countLabel = `習得済み: ${words.length}語`;
  } else {
    const levelStr = _browseLevel === 'all' ? '' : ` (${levelLabels[_browseLevel]})`;
    countLabel = `${words.length}語${levelStr}`;
  }

  container.innerHTML = `
    <div class="page page--wide">
      <h1 class="page-title">単語帳</h1>

      <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-3);flex-wrap:wrap">
        ${['all','novice1','novice2','level1','level2','level3','level4','level5'].map(lv => `
          <button class="category-pill ${_browseLevel === lv ? 'active' : ''}" data-level="${lv}">
            ${levelLabels[lv]}
          </button>`).join('')}
      </div>

      <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-4);flex-wrap:wrap">
        ${['rank','learned','mastered'].map(s => `
          <button class="category-pill ${_browseSort === s ? 'active' : ''}" data-sort="${s}">
            ${sortLabels[s]}
          </button>`).join('')}
      </div>

      <p class="text-sm text-muted" style="margin-bottom:var(--space-3)">
        ${countLabel}
      </p>

      <div class="card-grid" id="browse-grid"></div>
    </div>
  `;

  // レベルフィルターボタン
  container.querySelectorAll('[data-level]').forEach(btn => {
    btn.addEventListener('click', () => {
      _browseLevel = btn.dataset.level;
      renderBrowse();
    });
  });

  // ソートボタン
  container.querySelectorAll('[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      _browseSort = btn.dataset.sort;
      renderBrowse();
    });
  });

  // 単語カードを描画
  const grid = container.querySelector('#browse-grid');
  for (const word of words) {
    const srs = allCards[String(word.id)];
    const state = srs?.state || 'new';

    const card = document.createElement('div');
    card.className = 'word-card';
    card.innerHTML = `
      <div class="word-card__top">
        <div>
          <div class="word-card__hanzi">${escapeHtml(word.hanzi)}</div>
          <div class="word-card__pinyin">${escapeHtml(word.pinyin)}</div>
        </div>
        <button class="word-card__speak-btn" aria-label="発音を聴く" title="発音を聴く">🔊</button>
      </div>
      <div class="word-card__meaning">${escapeHtml(word.meaning_ja || '')}</div>
      ${word.meaning_en ? `<div class="word-card__meaning-en">${escapeHtml(word.meaning_en)}</div>` : ''}
      <div class="word-card__state word-card__state--${state}"></div>
    `;
    card.addEventListener('click', () => showWordDetail(word, srs));
    card.querySelector('.word-card__speak-btn').addEventListener('click', e => {
      e.stopPropagation();
      speakWord(word.hanzi);
    });
    grid.appendChild(card);
  }
}

function showWordDetail(word, srsData) {
  const content = document.createElement('div');
  content.innerHTML = `
    <div style="text-align:center;margin-bottom:var(--space-6)">
      <div class="hanzi" style="font-size:4rem;margin-bottom:var(--space-2)">${escapeHtml(word.hanzi)}</div>
      <div style="font-size:1.2rem;color:var(--color-text-muted)">${escapeHtml(word.pinyin)}</div>
      <div style="font-size:1.5rem;font-weight:700;margin-top:var(--space-3)">${escapeHtml(word.meaning_ja || '')}</div>
      ${word.meaning_en ? `<div style="font-size:1.1rem;color:var(--color-text-muted);margin-top:var(--space-1)">${escapeHtml(word.meaning_en)}</div>` : ''}
    </div>
    ${word.example_sentence?.hanzi ? `
      <div class="card__example">
        <div class="card__example-hanzi hanzi">${escapeHtml(word.example_sentence.hanzi)}</div>
        <div class="card__example-pinyin">${escapeHtml(word.example_sentence.pinyin || '')}</div>
        <div class="card__example-meaning">${escapeHtml(word.example_sentence.meaning_ja || '')}</div>
      </div>
    ` : ''}
    ${word.notes_ja ? `<div class="card__notes">${escapeHtml(word.notes_ja)}</div>` : ''}
    ${srsData ? `
      <div class="text-sm text-muted" style="margin-top:var(--space-4)">
        状態: <strong>${stateLabel(srsData.state)}</strong> |
        インターバル: <strong>${srsData.interval}日</strong> |
        復習回数: <strong>${srsData.repetitions}回</strong>
      </div>
    ` : '<div class="text-sm text-muted" style="margin-top:var(--space-4)">まだ学習していません</div>'}
  `;
  modal({ title: '', content });
}

// ─── 統計ページ ──────────────────────────────────────────────────────

function renderStatsView() {
  const container = $('view-stats');
  if (!container) return;

  container.innerHTML = `
    <div class="page">
      <h1 class="page-title">統計・進捗</h1>
      <div id="stats-content"></div>
    </div>
  `;

  renderStats(container.querySelector('#stats-content'));
}

// ─── 設定ページ ──────────────────────────────────────────────────────

function renderSettings() {
  const container = $('view-settings');
  if (!container) return;
  const settings = Store.getSettings();

  container.innerHTML = `
    <div class="page">
      <h1 class="page-title">設定</h1>

      <div class="surface-card" style="margin-bottom:var(--space-4)">
        <div class="section-title" style="margin-bottom:var(--space-4)">学習レベル</div>
        <div class="settings-row">
          <div>
            <div class="settings-row__label">対象レベル</div>
            <div class="settings-row__desc">学習・復習するカードの範囲</div>
          </div>
          <select class="select" id="setting-study-level">
            <option value="all"     ${settings.studyLevel === 'all'     ? 'selected' : ''}>全体（全レベル：7,517語）</option>
            <option value="novice1" ${settings.studyLevel === 'novice1' ? 'selected' : ''}>準備級一級（Novice 1）・160語</option>
            <option value="novice2" ${settings.studyLevel === 'novice2' ? 'selected' : ''}>準備級二級（Novice 2）・234語</option>
            <option value="level1"  ${settings.studyLevel === 'level1'  ? 'selected' : ''}>入門級（Level 1）・347語</option>
            <option value="level2"  ${settings.studyLevel === 'level2'  ? 'selected' : ''}>基礎級（Level 2）・485語</option>
            <option value="level3"  ${settings.studyLevel === 'level3'  ? 'selected' : ''}>進階級（Level 3）・1,173語</option>
            <option value="level4"  ${settings.studyLevel === 'level4'  ? 'selected' : ''}>高階級（Level 4）・2,342語</option>
            <option value="level5"  ${settings.studyLevel === 'level5'  ? 'selected' : ''}>流利級（Level 5）・2,776語</option>
          </select>
        </div>
      </div>

      <div class="surface-card" style="margin-bottom:var(--space-4)">
        <div class="settings-row">
          <div>
            <div class="settings-row__label">1日の新規カード数</div>
            <div class="settings-row__desc">毎日何枚の新規単語を導入するか</div>
          </div>
          <select class="select" id="setting-daily-new">
            <option value="5" ${settings.dailyNewLimit === 5 ? 'selected' : ''}>5枚</option>
            <option value="10" ${settings.dailyNewLimit === 10 ? 'selected' : ''}>10枚</option>
            <option value="20" ${settings.dailyNewLimit === 20 ? 'selected' : ''}>20枚</option>
            <option value="30" ${settings.dailyNewLimit === 30 ? 'selected' : ''}>30枚</option>
          </select>
        </div>

        <div class="settings-row">
          <div>
            <div class="settings-row__label">テーマ</div>
            <div class="settings-row__desc">アプリの外観</div>
          </div>
          <select class="select" id="setting-theme">
            <option value="auto" ${settings.theme === 'auto' ? 'selected' : ''}>自動（システム）</option>
            <option value="light" ${settings.theme === 'light' ? 'selected' : ''}>ライト</option>
            <option value="dark" ${settings.theme === 'dark' ? 'selected' : ''}>ダーク</option>
          </select>
        </div>
      </div>

      <div class="surface-card" style="margin-bottom:var(--space-4)">
        <div class="section-title" style="margin-bottom:var(--space-4)">発声機能（TTS）</div>

        <div class="settings-row">
          <div>
            <div class="settings-row__label">自動読み上げ</div>
            <div class="settings-row__desc">カード表示時に自動で発音を再生する</div>
          </div>
          <select class="select" id="setting-autoplay">
            <option value="off" ${!settings.autoplayAudio ? 'selected' : ''}>オフ</option>
            <option value="on" ${settings.autoplayAudio ? 'selected' : ''}>オン</option>
          </select>
        </div>

        <div class="settings-row">
          <div>
            <div class="settings-row__label">読み上げ速度</div>
            <div class="settings-row__desc">1.0x が標準速度</div>
          </div>
          <select class="select" id="setting-tts-rate">
            <option value="0.5" ${(settings.ttsRate || 0.8) == 0.5 ? 'selected' : ''}>0.5x（ゆっくり）</option>
            <option value="0.7" ${(settings.ttsRate || 0.8) == 0.7 ? 'selected' : ''}>0.7x</option>
            <option value="0.8" ${(settings.ttsRate || 0.8) == 0.8 ? 'selected' : ''}>0.8x（推奨）</option>
            <option value="1.0" ${(settings.ttsRate || 0.8) == 1.0 ? 'selected' : ''}>1.0x（標準）</option>
            <option value="1.2" ${(settings.ttsRate || 0.8) == 1.2 ? 'selected' : ''}>1.2x（速い）</option>
          </select>
        </div>
      </div>

      <div class="surface-card" style="margin-bottom:var(--space-4)">
        <div class="section-title" style="margin-bottom:var(--space-4)">データ管理</div>

        <div style="display:flex;flex-direction:column;gap:var(--space-3)">
          <button class="btn btn--secondary" id="btn-export">
            ${ICONS.download} 進捗をエクスポート（JSON）
          </button>
          <button class="btn btn--secondary" id="btn-import">
            ${ICONS.upload} 進捗をインポート
          </button>
          <input type="file" id="import-file" accept=".json" style="display:none">
          <button class="btn btn--secondary" id="btn-reset" style="color:var(--color-primary)">
            全データをリセット
          </button>
        </div>
      </div>

      <div class="surface-card surface-card--sm">
        <p class="text-xs text-muted" style="text-align:center">
          台湾華語フラッシュカード v1.0<br>
          SM-2 アルゴリズムによる間隔反復学習
        </p>
      </div>
    </div>
  `;

  // 設定変更ハンドラー
  container.querySelector('#setting-study-level')?.addEventListener('change', e => {
    Store.updateSettings({ studyLevel: e.target.value });
    toast('学習レベルを変更しました', 'success');
  });

  container.querySelector('#setting-daily-new')?.addEventListener('change', e => {
    Store.updateSettings({ dailyNewLimit: Number(e.target.value) });
    toast('設定を保存しました', 'success');
  });

  container.querySelector('#setting-theme')?.addEventListener('change', e => {
    setTheme(e.target.value);
    toast('テーマを変更しました', 'success');
  });

  container.querySelector('#setting-autoplay')?.addEventListener('change', e => {
    Store.updateSettings({ autoplayAudio: e.target.value === 'on' });
    toast('設定を保存しました', 'success');
  });

  container.querySelector('#setting-tts-rate')?.addEventListener('change', e => {
    Store.updateSettings({ ttsRate: Number(e.target.value) });
    toast('設定を保存しました', 'success');
  });

  // エクスポート
  container.querySelector('#btn-export')?.addEventListener('click', () => {
    const json = Store.exportProgress();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cmf-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('エクスポートしました', 'success');
  });

  // インポート
  container.querySelector('#btn-import')?.addEventListener('click', () => {
    container.querySelector('#import-file').click();
  });

  container.querySelector('#import-file')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const success = Store.importProgress(ev.target.result);
      toast(
        success ? 'インポート成功！ページを更新してください' : 'インポートに失敗しました',
        success ? 'success' : 'warning'
      );
    };
    reader.readAsText(file);
  });

  // リセット
  container.querySelector('#btn-reset')?.addEventListener('click', () => {
    if (confirm('全ての学習データをリセットしますか？この操作は元に戻せません。')) {
      Store.resetAll();
      toast('データをリセットしました', 'warning');
      renderHome();
      location.hash = '#home';
    }
  });
}

// ─── ユーティリティ ──────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stateLabel(state) {
  const labels = {
    new: '新規',
    learning: '学習中',
    young: '若い',
    mature: '成熟（習得済み）',
    burned: '定着済み',
    relearn: '再学習',
  };
  return labels[state] || state;
}

// ─── 起動 ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
