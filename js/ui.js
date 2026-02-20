/**
 * ui.js - UI ユーティリティ
 * トースト通知、モーダル、テーマ切替、その他 UI ヘルパーを担当する
 */

import { Store } from './store.js';

// ─── トースト通知 ────────────────────────────────────────────────────

let _toastContainer = null;

function getToastContainer() {
  if (!_toastContainer) {
    _toastContainer = document.createElement('div');
    _toastContainer.className = 'toast-container';
    document.body.appendChild(_toastContainer);
  }
  return _toastContainer;
}

/**
 * トースト通知を表示する
 * @param {string} message
 * @param {'info'|'success'|'warning'|'milestone'} type
 * @param {number} duration ミリ秒
 */
export function toast(message, type = 'info', duration = 3000) {
  const container = getToastContainer();
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;

  const icon = document.createElement('span');
  icon.className = 'toast__icon';
  icon.textContent = {
    info: 'ℹ️',
    success: '✅',
    warning: '⚠️',
    milestone: '🏆',
  }[type] || 'ℹ️';

  const msg = document.createElement('span');
  msg.className = 'toast__message';
  msg.textContent = message;

  t.appendChild(icon);
  t.appendChild(msg);
  container.appendChild(t);

  // 自動削除
  setTimeout(() => {
    t.style.animation = 'fadeIn 0.2s ease reverse';
    setTimeout(() => t.remove(), 200);
  }, duration);
}

// ─── マイルストーン ───────────────────────────────────────────────────

const MILESTONES = [
  { count: 50,   badge: '🌱', label: '芽吹き',       message: '50語習得！素晴らしいスタートです！' },
  { count: 100,  badge: '🌿', label: '成長中',       message: '100語達成！最初の1割クリア！' },
  { count: 200,  badge: '🌲', label: '木になった',   message: '200語！着実に成長しています！' },
  { count: 300,  badge: '⭐', label: 'スター',       message: '300語！TOCFL A2 レベル相当！' },
  { count: 500,  badge: '🏆', label: '折り返し点',   message: '500語！ちょうど半分！あと少し！' },
  { count: 750,  badge: '💎', label: 'ダイヤモンド', message: '750語！ゴールまであと25%！' },
  { count: 1000, badge: '🎓', label: '卒業',         message: '🎉 1000語完全習得！おめでとうございます！' },
];

let _lastMilestoneCount = 0;

/**
 * 習得語数に応じてマイルストーントーストを表示する
 * @param {number} masteredCount
 */
export function checkMilestones(masteredCount) {
  for (const m of MILESTONES) {
    if (masteredCount >= m.count && _lastMilestoneCount < m.count) {
      _lastMilestoneCount = m.count;
      setTimeout(() => {
        toast(`${m.badge} ${m.message}`, 'milestone', 5000);
      }, 500);
    }
  }
}

export function getMilestones() {
  return MILESTONES;
}

// ─── モーダル ────────────────────────────────────────────────────────

/**
 * モーダルダイアログを表示する
 * @param {{ title: string, content: HTMLElement|string, onClose?: () => void }} options
 * @returns {{ close: () => void }}
 */
export function modal({ title, content, onClose } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const m = document.createElement('div');
  m.className = 'modal';

  const header = document.createElement('div');
  header.className = 'modal__header';

  const titleEl = document.createElement('h2');
  titleEl.className = 'modal__title';
  titleEl.textContent = title || '';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn btn--ghost btn--icon';
  closeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

  header.appendChild(titleEl);
  header.appendChild(closeBtn);
  m.appendChild(header);

  if (typeof content === 'string') {
    const div = document.createElement('div');
    div.textContent = content;
    m.appendChild(div);
  } else if (content) {
    m.appendChild(content);
  }

  overlay.appendChild(m);
  document.body.appendChild(overlay);

  const close = () => {
    overlay.remove();
    onClose?.();
  };

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', e => {
    if (e.target === overlay) close();
  });

  return { close };
}

// ─── テーマ管理 ──────────────────────────────────────────────────────

/**
 * テーマを設定する
 * @param {'auto'|'light'|'dark'} theme
 */
export function setTheme(theme) {
  const root = document.documentElement;
  root.removeAttribute('data-theme');

  if (theme === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else if (theme === 'light') {
    root.setAttribute('data-theme', 'light');
  }
  // 'auto' は CSS の prefers-color-scheme に委任

  Store.updateSettings({ theme });
}

export function applyStoredTheme() {
  const settings = Store.getSettings();
  setTheme(settings.theme || 'auto');
}

// ─── カテゴリフィルター ───────────────────────────────────────────────

/**
 * カテゴリピルを描画する
 * @param {HTMLElement} container
 * @param {object[]} categories
 * @param {string[]} selected
 * @param {(selected: string[]) => void} onChange
 */
export function renderCategoryFilters(container, categories, selected, onChange) {
  container.innerHTML = '';
  container.className = 'category-pills-scroll';

  // 「すべて」ピル
  const allPill = document.createElement('button');
  allPill.className = `category-pill${selected.length === 0 ? ' active' : ''}`;
  allPill.textContent = 'すべて';
  allPill.addEventListener('click', () => onChange([]));
  container.appendChild(allPill);

  for (const cat of categories) {
    const pill = document.createElement('button');
    const isActive = selected.includes(cat.id);
    pill.className = `category-pill${isActive ? ' active' : ''}`;
    pill.textContent = cat.name_ja || cat.id;
    pill.addEventListener('click', () => {
      const next = isActive
        ? selected.filter(s => s !== cat.id)
        : [...selected, cat.id];
      onChange(next);
    });
    container.appendChild(pill);
  }
}

// ─── 数値カウンターアニメーション ────────────────────────────────────

/**
 * 数値をアニメーションして表示する
 * @param {HTMLElement} element
 * @param {number} from
 * @param {number} to
 * @param {number} duration ミリ秒
 */
export function animateCounter(element, from, to, duration = 800) {
  const start = performance.now();
  const diff = to - from;

  function step(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    element.textContent = Math.round(from + diff * eased);
    if (progress < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

// ─── ローディングスケルトン ──────────────────────────────────────────

export function showSkeleton(container, count = 4) {
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const s = document.createElement('div');
    s.className = 'skeleton';
    s.style.height = '80px';
    s.style.marginBottom = 'var(--space-3)';
    container.appendChild(s);
  }
}

// ─── SVG アイコン ────────────────────────────────────────────────────

export const ICONS = {
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  study: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
  browse: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
  stats: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`,
  undo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>`,
  download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  upload: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
};
