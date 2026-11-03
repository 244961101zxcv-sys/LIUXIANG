import { initHero } from './hero.js';
import { ModelViewer, isModelFile, extensionOf } from './viewer.js';
import {
  listLocalWorks,
  getLocalWork,
  saveLocalWork,
  deleteLocalWork,
  clearLocalWorks,
} from './db.js';

const $ = (id) => document.getElementById(id);
const qs = (selector, root = document) => root.querySelector(selector);
const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

const CATEGORY_LABELS = {
  character: '角色',
  creature: '生物',
  prop: '道具',
  study: '研究',
  open: '待上传',
};

const CATEGORY_DEFAULT_ROLES = {
  character: '3D 角色 / 风格化',
  creature: '3D 生物 / 怪物',
  prop: '3D 硬表面 / 道具',
  study: '解剖 / 结构研究',
};

const CATEGORY_KEYS = Object.keys(CATEGORY_DEFAULT_ROLES);

function normalizeCategory(value, fallback = 'character') {
  return CATEGORY_KEYS.includes(value) ? value : fallback;
}

const PLACEHOLDER_COVER = 'assets/cover-placeholder.svg';
const MAX_STORAGE_HINT = 200 * 1024 * 1024;
const MAX_SINGLE_FILE = 100 * 1024 * 1024;

const state = {
  data: null,
  works: [],
  locals: new Map(),
  filter: 'all',
  hero: null,
  viewer: null,
  viewerSlot: null,
  viewerToken: 0,
  viewerReturnFocus: null,
  viewReady: false,
  uploadSlot: null,
  uploadFiles: [],
  uploadReturnFocus: null,
  autoCaptureTimer: 0,
  dbWarned: false,
};

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function normalizePath(path = '') {
  return String(path)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');
}

function safeBlobName(name = '') {
  return normalizePath(name).replace(/^\.\//, '').replace(/\.\.(\/|$)/g, '');
}

function bytesOfLocal(record) {
  if (!record) return 0;
  let total = record.coverBlob?.size || 0;
  for (const file of record.files || []) total += file.blob?.size || 0;
  return total;
}

function baseWork(slot) {
  return state.data?.works?.find((work) => Number(work.slot) === Number(slot)) || null;
}

function mergeWork(work) {
  if (!work) return null;
  const local = state.locals.get(Number(work.slot)) || null;
  const isOpen = !local && !work.cover;
  let cover = work.cover || null;
  if (local?.coverBlob) {
    cover = URL.createObjectURL(local.coverBlob);
  }
  return {
    ...work,
    title: local?.title || work.title || '未命名作品',
    subtitle: local && /^open slot/i.test(work.subtitle || '') ? '' : (work.subtitle || ''),
    role: local?.role || work.role || CATEGORY_DEFAULT_ROLES[work.category] || '',
    category: normalizeCategory(local?.category || work.category, 'character'),
    description: local?.description || work.description || '',
    year: work.year === '—' ? (state.data?.meta?.year || '') : work.year,
    cover,
    isOpen,
    isLocal: Boolean(local),
    local,
    hasModel: Boolean(local?.files?.length || work.model),
  };
}

function currentWork(slot) {
  return state.works.find((work) => Number(work.slot) === Number(slot)) || null;
}

async function fetchData() {
  if (window.location.protocol === 'file:') {
    throw new Error('这个网站使用 ES Modules 和本地数据文件，不能直接双击 index.html 打开。请在文件夹里运行“本地预览.bat”，或直接部署到 GitHub Pages。');
  }
  const response = await fetch(new URL('../data/works.json', import.meta.url), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`读取 data/works.json 失败（HTTP ${response.status}）。请确认文件路径和服务器根目录。`);
  }
  return response.json();
}

async function refreshLocals({ silent = false } = {}) {
  try {
    const records = await listLocalWorks();
    state.locals = new Map(records.map((record) => [Number(record.slot), record]));
  } catch (error) {
    state.locals = new Map();
    if (!silent) {
      showToast(`本地存储不可用：${error.message}`, { error: true, duration: 5000 });
    }
  }
}

function renderAll() {
  state.works = (state.data?.works || []).map(mergeWork).filter(Boolean);
  renderWorks();
  renderCurator();
  updateCounts();
  updateStorageMeter();
}

function updateCounts() {
  const filled = state.works.filter((work) => !work.isOpen).length;
  const open = state.works.length - filled;
  const workCount = $('work-count');
  if (workCount) workCount.textContent = pad2(filled);

  const heroFoot = qs('.hero-foot-mid');
  if (heroFoot) {
    heroFoot.innerHTML = `<strong>${pad2(filled)}</strong> 件作品 <span>·</span> <strong>${pad2(open)}</strong> 个开放展示位`;
  }

  const aboutFilled = qs('.about-stats strong');
  if (aboutFilled) aboutFilled.textContent = pad2(filled);

  const indexFoot = qs('.index-foot p');
  if (indexFoot) {
    indexFoot.innerHTML = `<span class="status-dot"></span> ${pad2(filled)} 件作品已入档，${pad2(open)} 个展示位等待新模型。`;
  }

  const counts = { all: state.works.length, character: 0, creature: 0, prop: 0, study: 0, open: 0 };
  for (const work of state.works) {
    if (work.isOpen) counts.open += 1;
    else if (counts[work.category] !== undefined) counts[work.category] += 1;
  }
  for (const [key, value] of Object.entries(counts)) {
    const span = qs(`.filter[data-filter="${key}"] span`);
    if (span) span.textContent = pad2(value);
  }
}

function renderWorks() {
  const grid = $('works-grid');
  const template = $('work-card-template');
  if (!grid || !template) return;
  grid.innerHTML = '';

  state.works.forEach((work, index) => {
    const fragment = template.content.cloneNode(true);
    const card = qs('.work-card', fragment);
    const button = qs('.work-card-button', fragment);
    const cover = qs('.work-cover', fragment);
    const badge = qs('.work-badge', fragment);
    const name = qs('.work-name', fragment);
    const no = qs('.work-no', fragment);
    const category = qs('.work-category', fragment);
    const hoverLabel = qs('.work-hover-label', fragment);

    card.dataset.slot = String(work.slot);
    card.dataset.category = work.category;
    card.style.animationDelay = `${Math.min(index * 35, 360)}ms`;
    if (work.isOpen) card.classList.add('is-open');
    no.textContent = pad2(work.slot);
    name.textContent = work.isOpen ? '待上传作品' : work.title;
    category.textContent = work.isOpen ? 'UPLOAD' : (CATEGORY_LABELS[work.category] || work.category).toUpperCase();
    hoverLabel.textContent = work.isOpen ? 'UPLOAD MODEL' : 'OPEN ARCHIVE';
    cover.alt = work.isOpen ? '' : `${work.title}${work.role ? ` · ${work.role}` : ''}`;
    cover.loading = index < 5 ? 'eager' : 'lazy';

    if (work.cover) {
      cover.src = work.cover;
      cover.style.objectPosition = work.focus || '50% 50%';
    } else {
      cover.removeAttribute('src');
    }

    if (work.hasModel) {
      badge.textContent = work.isLocal ? 'LOCAL 3D' : '3D READY';
      badge.classList.add(work.isLocal ? 'is-local' : 'is-3d');
    } else if (work.isOpen) {
      badge.textContent = 'OPEN SLOT';
      badge.classList.add('is-open');
    } else {
      badge.textContent = 'STILL';
    }

    button.setAttribute(
      'aria-label',
      work.isOpen ? `上传第 ${work.slot} 个展示位的模型` : `打开《${work.title}》的 3D 预览`,
    );
    button.addEventListener('click', () => {
      if (work.isOpen) openUpload(work.slot);
      else openViewer(work.slot);
    });

    grid.appendChild(fragment);
  });

  applyFilter(state.filter, { updateUi: false });
}

function applyFilter(filter, { updateUi = true } = {}) {
  state.filter = filter;
  const cards = qsa('.work-card', $('works-grid'));
  for (const card of cards) {
    const work = currentWork(card.dataset.slot);
    if (!work) continue;
    const visible = filter === 'all'
      || (filter === 'open' ? work.isOpen : (!work.isOpen && work.category === filter));
    card.classList.toggle('is-hidden', !visible);
  }
  if (updateUi) {
    for (const button of qsa('.filter')) {
      const active = button.dataset.filter === filter;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }
}

function renderCurator() {
  const list = $('curator-list');
  if (!list) return;
  list.innerHTML = '';

  for (const work of state.works) {
    const row = document.createElement('div');
    row.className = 'curator-row';
    row.dataset.slot = String(work.slot);

    const no = document.createElement('p');
    no.className = 'curator-no';
    no.textContent = pad2(work.slot);

    const thumb = document.createElement('div');
    thumb.className = 'curator-thumb';
    if (work.cover) {
      const image = document.createElement('img');
      image.src = work.cover;
      image.alt = '';
      image.loading = 'lazy';
      thumb.appendChild(image);
    } else {
      thumb.classList.add('is-empty');
    }

    const title = document.createElement('div');
    title.className = 'curator-title';
    const strong = document.createElement('strong');
    strong.textContent = work.isOpen ? '待上传作品' : work.title;
    const meta = document.createElement('span');
    const status = document.createElement('span');
    status.className = 'curator-status';
    if (work.isLocal) {
      status.textContent = work.hasModel ? '本地 3D' : '本地资料';
      status.classList.add('is-model');
    } else if (work.model) {
      status.textContent = '已发布 3D';
      status.classList.add('is-model');
    } else if (work.isOpen) {
      status.textContent = '空缺';
      status.classList.add('is-open');
    } else {
      status.textContent = '仅图片';
    }
    meta.append(`${work.role || '—'} `, status);
    if (work.local?.updatedAt) {
      meta.append(` · ${formatDate(work.local.updatedAt)}`);
    }
    title.append(strong, meta);

    const actions = document.createElement('div');
    actions.className = 'curator-actions';
    if (!work.isOpen) {
      const view = document.createElement('button');
      view.type = 'button';
      view.dataset.action = 'view';
      view.textContent = '查看';
      actions.appendChild(view);
    }
    const upload = document.createElement('button');
    upload.type = 'button';
    upload.dataset.action = 'upload';
    upload.textContent = work.hasModel ? '替换' : '上传';
    actions.appendChild(upload);
    if (work.isLocal) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.dataset.action = 'remove';
      remove.className = 'is-danger';
      remove.textContent = '移除';
      actions.appendChild(remove);
    }

    row.append(no, thumb, title, actions);
    list.appendChild(row);
  }

  const localCount = state.locals.size;
  $('export-pack').disabled = localCount === 0;
  $('clear-local').disabled = localCount === 0;
}

function updateStorageMeter() {
  let total = 0;
  for (const record of state.locals.values()) total += bytesOfLocal(record);
  const size = $('storage-size');
  const fill = $('storage-bar-fill');
  if (size) size.textContent = `${formatBytes(total)} / 200 MB`;
  if (fill) {
    fill.style.width = `${Math.min(100, (total / MAX_STORAGE_HINT) * 100).toFixed(1)}%`;
    fill.style.background = total > MAX_STORAGE_HINT ? 'var(--danger)' : 'var(--accent)';
  }
}

function renderMeta() {
  const meta = state.data.meta || {};
  document.title = `${meta.siteSubtitle || '形体档案'} ${meta.siteTitle || 'FORM / 10'} — 3D 角色作品集`;

  const statement = $('about-statement');
  if (statement && meta.statement) statement.textContent = meta.statement;

  const tools = $('tools-list');
  if (tools && Array.isArray(meta.tools)) {
    tools.innerHTML = '';
    for (const tool of meta.tools) {
      const item = document.createElement('li');
      item.textContent = tool;
      tools.appendChild(item);
    }
  }

  const email = $('contact-email');
  if (email) {
    email.textContent = meta.email || 'hello@yourname.com';
    email.href = `mailto:${meta.email || 'hello@yourname.com'}`;
  }

  const artstation = $('contact-artstation');
  if (artstation) {
    const url = String(meta.artstation || '').trim();
    artstation.hidden = !url;
    if (url) artstation.href = url;
  }

  for (const artist of qsa('#footer-artist')) {
    artist.textContent = meta.artist || 'YOUR NAME';
  }
  const footerYear = $('footer-year');
  if (footerYear) footerYear.textContent = meta.year || String(new Date().getFullYear());

  const description = qs('meta[name="description"]');
  if (description) {
    description.content = `${meta.artist || '3D Artist'} 的 3D 角色、生物与硬表面道具作品档案。十个展示位，支持 GLB 实时 3D 预览。`;
  }
}

/* -------------------------------------------------------------------------- */
/* Modals                                                                      */
/* -------------------------------------------------------------------------- */

function getFocusable(container) {
  return qsa(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    container,
  ).filter((element) => element.offsetParent !== null);
}

function openModal(element) {
  if (!element) return;
  state.uploadReturnFocus = document.activeElement;
  element.classList.add('is-open');
  element.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  window.setTimeout(() => {
    const close = qs('.modal-close', element);
    (close || getFocusable(element)[0])?.focus({ preventScroll: true });
  }, 60);
}

function closeModal(element) {
  if (!element) return;
  element.classList.remove('is-open');
  element.setAttribute('aria-hidden', 'true');
  if (!qs('.modal.is-open') && !$('viewer').classList.contains('is-open')) {
    document.body.classList.remove('modal-open');
  }
  if (state.uploadReturnFocus && typeof state.uploadReturnFocus.focus === 'function') {
    state.uploadReturnFocus.focus?.({ preventScroll: true });
    state.uploadReturnFocus = null;
  }
}

function closeAllModals() {
  for (const modal of qsa('.modal.is-open')) closeModal(modal);
}

function openCurator() {
  closeViewer();
  closeAllModals();
  renderCurator();
  updateStorageMeter();
  openModal($('curator-modal'));
}

/* -------------------------------------------------------------------------- */
/* 3D viewer                                                                   */
/* -------------------------------------------------------------------------- */

function populateViewer(work) {
  $('viewer-no').textContent = pad2(work.slot);
  $('viewer-role').textContent = work.role || '—';
  $('viewer-title').textContent = work.title;
  $('viewer-subtitle').textContent = work.subtitle || '';
  $('viewer-desc').textContent = work.description || '这件作品还没有填写说明。';

  const specs = $('viewer-specs');
  specs.innerHTML = '';
  for (const spec of work.specs || []) {
    const item = document.createElement('li');
    item.textContent = spec;
    specs.appendChild(item);
  }
  specs.hidden = !(work.specs || []).length;

  const poster = $('viewer-poster');
  poster.src = work.cover || PLACEHOLDER_COVER;
  poster.alt = work.title;

  $('viewer-stats').hidden = true;
  $('viewer-capture').hidden = !work.isLocal;
  $('viewer-auto').setAttribute('aria-pressed', 'false');
  $('viewer-empty').hidden = true;
  $('viewer-loader').classList.remove('is-done');
  $('loader-percent').textContent = '0%';

  const replaceLabel = qs('#viewer-replace span');
  if (replaceLabel) replaceLabel.textContent = work.hasModel ? '更换模型' : '上传模型';

  $('viewer-footnote').textContent = work.isLocal
    ? 'LOCAL FILE · 仅保存在此浏览器'
    : work.hasModel
      ? 'PUBLISHED MODEL · 实时渲染'
      : '尚未绑定 3D 文件';

  $('viewer-empty-kicker').textContent = 'NO 3D FILE YET';
  $('viewer-empty-title').textContent = '这件作品还没有绑定 3D 模型';
  $('viewer-empty-desc').textContent = '上传 GLB / GLTF 后，这里会变成可实时旋转、平移和缩放的 3D 预览。';
  $('viewer-upload-btn').textContent = '上传模型';
}

function setViewerStats(info) {
  if (!info) return;
  $('viewer-stats').hidden = false;
  $('stat-format').textContent = info.format || '—';
  $('stat-tris').textContent = formatNumber(info.triangles);
  $('stat-mesh').textContent = formatNumber(info.meshCount);
  $('stat-size').textContent = info.bytes ? formatBytes(info.bytes) : '—';
}

function showViewerError(message) {
  $('viewer-loader').classList.add('is-done');
  $('viewer').classList.add('is-empty');
  $('viewer').classList.remove('has-model');
  $('viewer-empty').hidden = false;
  $('viewer-empty-kicker').textContent = 'LOAD ERROR';
  $('viewer-empty-title').textContent = '模型没有加载成功';
  $('viewer-empty-desc').textContent = `${message || '请检查文件是否完整。'} 建议重新导出为单文件 GLB，并确认小于 100MB。`;
  $('viewer-upload-btn').textContent = '重新选择模型';
  $('viewer-capture').hidden = true;
  $('viewer-stats').hidden = true;
}

async function openViewer(slot) {
  const work = currentWork(slot);
  if (!work || work.isOpen) return;

  closeAllModals();
  state.viewerReturnFocus = document.activeElement;
  state.viewerSlot = Number(slot);
  state.viewReady = false;
  const token = ++state.viewerToken;
  window.clearTimeout(state.autoCaptureTimer);

  state.viewer?.dispose();
  state.viewer = null;
  $('viewer-canvas-wrap').innerHTML = '';

  populateViewer(work);
  const viewerEl = $('viewer');
  viewerEl.classList.add('is-open');
  viewerEl.setAttribute('aria-hidden', 'false');
  document.body.classList.add('viewer-open');
  state.hero?.setPaused?.(true);

  if (window.location.hash !== `#work-${pad2(slot)}`) {
    history.replaceState(null, '', `#work-${pad2(slot)}`);
  }

  window.setTimeout(() => {
    if (viewerEl.classList.contains('is-open')) {
      $('viewer-close')?.focus({ preventScroll: true });
    }
  }, 80);

  if (!work.hasModel) {
    $('viewer-loader').classList.add('is-done');
    $('viewer-empty').hidden = false;
    viewerEl.classList.add('is-empty');
    viewerEl.classList.remove('has-model');
    return;
  }

  viewerEl.classList.remove('is-empty');
  viewerEl.classList.remove('has-model');

  try {
    const viewer = new ModelViewer($('viewer-canvas-wrap'), {
      onProgress(progress) {
        if (token !== state.viewerToken) return;
        const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
        $('loader-percent').textContent = `${percent}%`;
      },
      onReady(info) {
        if (token !== state.viewerToken) return;
        state.viewReady = true;
        $('viewer-loader').classList.add('is-done');
        viewerEl.classList.add('has-model');
        viewerEl.classList.remove('is-empty');
        $('viewer-empty').hidden = true;
        setViewerStats(info);
        if (work.isLocal) {
          $('viewer-capture').hidden = false;
          if (!work.local?.coverBlob && !baseWork(slot)?.cover) {
            state.autoCaptureTimer = window.setTimeout(() => {
              if (token === state.viewerToken) captureCover(true);
            }, 900);
          }
        }
      },
      onError(error) {
        if (token !== state.viewerToken) return;
        showViewerError(error?.message || '未知错误');
      },
    });
    state.viewer = viewer;
    await viewer.load(work, work.local);
  } catch (error) {
    if (token !== state.viewerToken) return;
    console.error(error);
    showViewerError(error?.message || '浏览器无法读取这个模型。');
  }
}

function closeViewer() {
  const viewerEl = $('viewer');
  if (!viewerEl?.classList.contains('is-open')) return;
  state.viewerToken += 1;
  state.viewerSlot = null;
  state.viewReady = false;
  window.clearTimeout(state.autoCaptureTimer);
  state.viewer?.dispose();
  state.viewer = null;
  $('viewer-canvas-wrap').innerHTML = '';
  viewerEl.classList.remove('is-open', 'has-model', 'is-empty');
  viewerEl.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('viewer-open');
  state.hero?.setPaused?.(false);
  if (window.location.hash.startsWith('#work-')) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  if (state.viewerReturnFocus && typeof state.viewerReturnFocus.focus === 'function') {
    state.viewerReturnFocus.focus?.({ preventScroll: true });
    state.viewerReturnFocus = null;
  }
}

async function captureCover(auto = false) {
  if (!state.viewer || !state.viewReady || !state.viewerSlot) return;
  const slot = state.viewerSlot;
  const button = $('viewer-capture');
  const oldText = button.querySelector('span')?.textContent;
  button.disabled = true;
  if (button.querySelector('span')) button.querySelector('span').textContent = '生成中…';
  try {
    const blob = await state.viewer.captureCover(900);
    if (!blob) throw new Error('浏览器没有生成图片。');
    const record = await getLocalWork(slot);
    if (!record) throw new Error('本地记录不存在。');
    record.coverBlob = blob;
    record.updatedAt = new Date().toISOString();
    await saveLocalWork(record);
    state.locals.set(Number(slot), record);
    state.works = state.data.works.map(mergeWork);
    renderWorks();
    renderCurator();
    updateStorageMeter();
    if (!auto) showToast('封面已更新，作品索引已同步。');
  } catch (error) {
    if (!auto) showToast(`封面生成失败：${error.message}`, { error: true });
  } finally {
    button.disabled = false;
    if (button.querySelector('span') && oldText) button.querySelector('span').textContent = oldText;
  }
}

/* -------------------------------------------------------------------------- */
/* Upload                                                                      */
/* -------------------------------------------------------------------------- */

function setFormError(message = '') {
  const box = $('form-error');
  box.textContent = message;
  box.hidden = !message;
}

function preferredEntry(files) {
  const models = files.filter(({ name }) => isModelFile(name));
  if (!models.length) return '';
  const rank = (name) => {
    const ext = extensionOf(name);
    return { glb: 0, gltf: 1, obj: 2, stl: 3 }[ext] ?? 9;
  };
  return [...models].sort((a, b) => rank(a.name) - rank(b.name) || a.name.length - b.name.length)[0].name;
}

function updateFileSummary() {
  const files = state.uploadFiles;
  const summary = $('file-summary');
  const list = $('file-list');
  const entryField = $('entry-field');
  const entrySelect = $('field-entry');

  if (!files.length) {
    summary.hidden = true;
    entryField.hidden = true;
    return;
  }

  summary.hidden = false;
  const total = files.reduce((sum, item) => sum + (item.file.size || 0), 0);
  $('file-count').textContent = String(files.length);
  $('file-total').textContent = formatBytes(total);
  list.innerHTML = '';
  for (const item of files.slice(0, 12)) {
    const li = document.createElement('li');
    li.textContent = `${safeBlobName(item.name)} · ${formatBytes(item.file.size)}`;
    list.appendChild(li);
  }
  if (files.length > 12) {
    const li = document.createElement('li');
    li.textContent = `+${files.length - 12} 个文件`;
    list.appendChild(li);
  }

  const models = files.filter(({ name }) => isModelFile(name));
  entrySelect.innerHTML = '';
  for (const item of models) {
    const option = document.createElement('option');
    option.value = item.name;
    option.textContent = safeBlobName(item.name);
    entrySelect.appendChild(option);
  }
  const preferred = preferredEntry(files);
  if (preferred) entrySelect.value = preferred;
  entryField.hidden = models.length <= 1;

  if (!models.length) {
    setFormError('没有检测到模型入口文件。请选择 .glb / .gltf / .obj / .stl，或把整个模型文件夹一起拖入。');
  } else {
    setFormError('');
    const title = $('field-title');
    if (!title.value.trim()) {
      const raw = preferred.split('/').pop().replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
      title.value = raw.slice(0, 40);
    }
  }

  const oversize = files.find((item) => item.file.size > MAX_SINGLE_FILE);
  if (oversize) {
    setFormError(`“${safeBlobName(oversize.name)}”超过 100MB，GitHub Pages 无法稳定托管，请压缩后再上传。`);
  }
}

function setUploadFiles(files) {
  state.uploadFiles = files
    .filter(({ file, name }) => file && file.size >= 0 && name && !name.endsWith('/.DS_Store'))
    .map(({ file, name }) => ({ file, name: normalizePath(name) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  updateFileSummary();
}

async function openUpload(slot) {
  closeViewer();
  closeAllModals();
  state.uploadSlot = Number(slot);
  state.uploadFiles = [];
  state.uploadReturnFocus = document.activeElement;

  const work = currentWork(slot) || baseWork(slot);
  const local = state.locals.get(Number(slot));
  const category = normalizeCategory(local?.category || work?.category, 'character');
  const form = $('upload-form');
  form.reset();
  $('upload-modal').dataset.slot = String(slot);
  $('upload-slot-label').textContent = pad2(slot);
  $('upload-title').textContent = local || work?.hasModel ? '替换 3D 模型' : '上传 3D 模型';
  $('field-title').value = local?.title || (work?.isOpen ? '' : work?.title || '');
  $('field-category').value = category;
  const roleFallback = work?.isOpen
    ? CATEGORY_DEFAULT_ROLES[category]
    : work?.role || CATEGORY_DEFAULT_ROLES[category];
  $('field-role').value = local?.role || roleFallback;
  $('field-description').value = local?.description || (work?.isOpen ? '' : work?.description) || '';
  $('file-summary').hidden = true;
  $('entry-field').hidden = true;
  $('dropzone').classList.remove('is-over');
  setFormError('');
  $('upload-submit').disabled = false;
  openModal($('upload-modal'));
}

function resetUploadFiles() {
  state.uploadFiles = [];
  $('file-input').value = '';
  $('folder-input').value = '';
  $('file-summary').hidden = true;
  $('entry-field').hidden = true;
  setFormError('');
}

async function walkEntry(entry, base = '') {
  if (!entry) return [];
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    return [{ file, name: `${base}${file.name}` }];
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const children = [];
    while (true) {
      const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      children.push(...batch);
    }
    const result = [];
    for (const child of children) {
      result.push(...await walkEntry(child, `${base}${entry.name}/`));
    }
    return result;
  }
  return [];
}

async function filesFromDrop(dataTransfer) {
  const items = [...(dataTransfer.items || [])];
  if (items.length && items[0].webkitGetAsEntry) {
    const entries = items
      .filter((item) => item.kind === 'file')
      .map((item) => item.webkitGetAsEntry())
      .filter(Boolean);
    if (entries.length) {
      const result = [];
      for (const entry of entries) result.push(...await walkEntry(entry));
      if (result.length) return result;
    }
  }
  return [...(dataTransfer.files || [])].map((file) => ({ file, name: file.webkitRelativePath || file.name }));
}

async function handleUploadSubmit(event) {
  event.preventDefault();
  if (!state.uploadSlot) return;
  const slot = state.uploadSlot;
  const files = state.uploadFiles;
  const entry = $('field-entry').hidden
    ? preferredEntry(files)
    : $('field-entry').value || preferredEntry(files);
  const title = $('field-title').value.trim();
  const role = $('field-role').value.trim();

  if (!files.length) {
    setFormError('请先选择模型文件。');
    return;
  }
  if (!entry || !files.some((file) => file.name === entry)) {
    setFormError('请选择正确的入口文件。');
    return;
  }
  if (!title) {
    setFormError('请给作品起一个名字。');
    $('field-title').focus();
    return;
  }
  const oversize = files.find((file) => file.file.size > MAX_SINGLE_FILE);
  if (oversize) {
    setFormError(`“${safeBlobName(oversize.name)}”超过 100MB，请压缩模型后再试。`);
    return;
  }
  const total = files.reduce((sum, file) => sum + file.file.size, 0);
  if (total > 500 * 1024 * 1024) {
    setFormError('这一组文件超过 500MB，浏览器本地存储和 GitHub Pages 都不适合。请先压缩。');
    return;
  }

  const submit = $('upload-submit');
  const submitLabel = submit.querySelector('span');
  const oldLabel = submitLabel.textContent;
  submit.disabled = true;
  submitLabel.textContent = '保存中…';
  setFormError('');

  try {
    const existing = state.locals.get(Number(slot));
    const coverFile = $('field-cover').files?.[0] || null;
    if (coverFile && !coverFile.type.startsWith('image/')) {
      throw new Error('封面必须是图片文件。');
    }
    const category = normalizeCategory($('field-category').value, 'character');
    const record = {
      slot: Number(slot),
      title,
      category,
      role: role || CATEGORY_DEFAULT_ROLES[category],
      description: $('field-description').value.trim(),
      entryFile: entry,
      files: files.map(({ file, name }) => ({
        name: safeBlobName(name),
        type: file.type || 'application/octet-stream',
        blob: file,
      })),
      coverBlob: coverFile || existing?.coverBlob || null,
      updatedAt: new Date().toISOString(),
    };
    await saveLocalWork(record);
    await refreshLocals({ silent: true });
    renderAll();
    closeModal($('upload-modal'));
    showToast(`已保存到展示位 ${pad2(slot)}，正在打开 3D 预览。`);
    state.uploadSlot = null;
    state.uploadFiles = [];
    window.setTimeout(() => openViewer(slot), 180);
  } catch (error) {
    console.error(error);
    const message = error?.name === 'QuotaExceededError'
      ? '浏览器存储空间不足。请移除旧模型，或压缩后重试。'
      : error.message || '保存失败。';
    setFormError(message);
    showToast(message, { error: true, duration: 5000 });
  } finally {
    submit.disabled = false;
    submitLabel.textContent = oldLabel;
  }
}

async function removeLocal(slot) {
  const work = currentWork(slot);
  if (!work?.isLocal) return;
  const ok = window.confirm(`移除《${work.title}》的本地模型和封面？\n\n只会删除这个浏览器里的文件，已经发布到 GitHub 的版本不受影响。`);
  if (!ok) return;
  try {
    await deleteLocalWork(slot);
    await refreshLocals({ silent: true });
    if (state.viewerSlot === Number(slot)) closeViewer();
    renderAll();
    showToast(`已移除展示位 ${pad2(slot)} 的本地模型。`);
  } catch (error) {
    showToast(`移除失败：${error.message}`, { error: true });
  }
}

async function clearAllLocal() {
  if (!state.locals.size) return;
  const ok = window.confirm(`清空全部 ${state.locals.size} 个本地模型？\n\n已经发布到 GitHub 的文件不会被删除。`);
  if (!ok) return;
  try {
    await clearLocalWorks();
    await refreshLocals({ silent: true });
    closeViewer();
    renderAll();
    showToast('已清空本地模型。');
  } catch (error) {
    showToast(`清空失败：${error.message}`, { error: true });
  }
}

/* -------------------------------------------------------------------------- */
/* Publish pack                                                                */
/* -------------------------------------------------------------------------- */

function coverExtension(blob) {
  const type = blob?.type || '';
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  return 'jpg';
}

async function exportPack() {
  if (!state.locals.size) return;
  if (typeof window.JSZip !== 'function') {
    showToast('打包库没有加载，请刷新页面后重试。', { error: true });
    return;
  }

  const button = $('export-pack');
  const original = button.innerHTML;
  button.disabled = true;
  button.textContent = '打包 0%';

  try {
    const zip = new window.JSZip();
    const manifest = JSON.parse(JSON.stringify(state.data));
    let changed = 0;

    for (const [slot, record] of [...state.locals.entries()].sort((a, b) => a[0] - b[0])) {
      const work = manifest.works.find((item) => Number(item.slot) === Number(slot));
      if (!work) continue;
      const folder = `models/slot-${pad2(slot)}`;
      const entryName = safeBlobName(record.entryFile);
      let exportedEntry = '';

      for (const file of record.files || []) {
        const path = safeBlobName(file.name);
        if (!path) continue;
        zip.file(`${folder}/${path}`, file.blob, { binary: true });
        if (path === entryName) exportedEntry = `${folder}/${path}`;
      }
      if (!exportedEntry) {
        const first = record.files?.[0];
        if (first) exportedEntry = `${folder}/${safeBlobName(first.name)}`;
      }

      work.title = record.title;
      work.role = record.role;
      work.category = normalizeCategory(record.category, 'character');
      work.description = record.description;
      if (work.year === '—') work.year = manifest.meta?.year || String(new Date().getFullYear());
      if (/^open slot/i.test(work.subtitle || '')) work.subtitle = '';
      work.model = exportedEntry;
      work.updatedAt = record.updatedAt;
      if (record.coverBlob) {
        const ext = coverExtension(record.coverBlob);
        const coverPath = `covers/slot-${pad2(slot)}.${ext}`;
        zip.file(coverPath, record.coverBlob, { binary: true });
        work.cover = coverPath;
      }

      const mtl = (record.files || []).find((file) => extensionOf(file.name) === 'mtl');
      if (mtl) work.mtl = `${folder}/${safeBlobName(mtl.name)}`;
      changed += 1;
    }

    manifest.generatedAt = new Date().toISOString();
    zip.file('data/works.json', JSON.stringify(manifest, null, 2));
    zip.file(
      'README-publish.txt',
      [
        'FORM / 10 — website update pack',
        '',
        `生成时间：${new Date().toLocaleString('zh-CN')}`,
        `包含 ${changed} 个本地模型。`,
        '',
        '使用方法：',
        '1. 解压这个 ZIP。',
        '2. 把 models/、covers/ 和 data/works.json 上传到 GitHub 仓库根目录。',
        '3. 同名文件选择覆盖，提交后等待 GitHub Pages 重新部署（约 1–3 分钟）。',
        '4. 打开线上网址，用无痕窗口检查访客看到的版本。',
        '',
        '注意：models/ 与 covers/ 是新增目录；data/works.json 需要覆盖原文件。',
        '单个文件必须小于 100MB，仓库总大小建议控制在 1GB 以内。',
      ].join('\n'),
    );

    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'STORE' },
      (meta) => {
        button.textContent = `打包 ${Math.round(meta.percent)}%`;
      },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    anchor.href = url;
    anchor.download = `form10-site-update-${stamp}.zip`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast(`发布包已生成，包含 ${changed} 个模型。`);
  } catch (error) {
    console.error(error);
    showToast(`打包失败：${error.message}`, { error: true });
  } finally {
    button.disabled = state.locals.size === 0;
    button.innerHTML = original;
  }
}

/* -------------------------------------------------------------------------- */
/* Toast / errors / init                                                       */
/* -------------------------------------------------------------------------- */

function showToast(message, { error = false, duration = 3600 } = {}) {
  const region = $('toast-region');
  if (!region) return;
  const toast = document.createElement('div');
  toast.className = `toast${error ? ' is-error' : ''}`;
  toast.textContent = message;
  region.appendChild(toast);
  window.setTimeout(() => {
    toast.classList.add('is-out');
    window.setTimeout(() => toast.remove(), 280);
  }, duration);
}

function showFatal(error) {
  const grid = $('works-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'fatal';
  const kicker = document.createElement('p');
  kicker.className = 'section-kicker';
  kicker.textContent = 'CANNOT LOAD ARCHIVE';
  const title = document.createElement('h3');
  title.textContent = '作品数据没有加载出来';
  const text = document.createElement('p');
  text.textContent = error.message || '未知错误。';
  const hint = document.createElement('p');
  hint.className = 'fatal-hint';
  hint.textContent = '如果是在本地预览，请运行“本地预览.bat”，不要直接双击 index.html。';
  box.append(kicker, title, text, hint);
  grid.appendChild(box);
}

function bindEvents() {
  window.addEventListener('scroll', () => {
    $('site-header')?.classList.toggle('is-scrolled', window.scrollY > 20);
  }, { passive: true });

  for (const button of qsa('[data-open-curator]')) {
    button.addEventListener('click', openCurator);
  }
  for (const button of qsa('[data-close-modal]')) {
    button.addEventListener('click', () => closeModal(button.closest('.modal')));
  }

  for (const button of qsa('.filter')) {
    button.addEventListener('click', () => {
      for (const item of qsa('.filter')) {
        item.classList.toggle('is-active', item === button);
        item.setAttribute('aria-pressed', String(item === button));
      }
      applyFilter(button.dataset.filter, { updateUi: false });
    });
  }

  $('viewer-close')?.addEventListener('click', closeViewer);
  $('viewer-close-empty')?.addEventListener('click', closeViewer);
  $('viewer-upload-btn')?.addEventListener('click', () => {
    const slot = state.viewerSlot;
    if (slot) openUpload(slot);
  });
  $('viewer-replace')?.addEventListener('click', () => {
    const slot = state.viewerSlot;
    if (slot) openUpload(slot);
  });
  $('viewer-reset')?.addEventListener('click', () => state.viewer?.reset());
  $('viewer-capture')?.addEventListener('click', () => captureCover(false));
  $('viewer-auto')?.addEventListener('click', (event) => {
    const button = event.currentTarget;
    const enabled = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(enabled));
    state.viewer?.setAutoRotate(enabled);
  });

  $('curator-list')?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const row = button.closest('[data-slot]');
    const slot = Number(row?.dataset.slot);
    if (!slot) return;
    if (button.dataset.action === 'view') openViewer(slot);
    if (button.dataset.action === 'upload') openUpload(slot);
    if (button.dataset.action === 'remove') removeLocal(slot);
  });

  $('clear-local')?.addEventListener('click', clearAllLocal);
  $('export-pack')?.addEventListener('click', exportPack);

  $('pick-files')?.addEventListener('click', () => $('file-input').click());
  $('pick-folder')?.addEventListener('click', () => $('folder-input').click());
  $('file-input')?.addEventListener('change', (event) => {
    setUploadFiles([...event.target.files].map((file) => ({ file, name: file.webkitRelativePath || file.name })));
  });
  $('folder-input')?.addEventListener('change', (event) => {
    setUploadFiles([...event.target.files].map((file) => ({ file, name: file.webkitRelativePath || file.name })));
  });
  $('clear-files')?.addEventListener('click', resetUploadFiles);
  $('upload-form')?.addEventListener('submit', handleUploadSubmit);
  $('field-category')?.addEventListener('change', (event) => {
    const role = $('field-role');
    const knownDefaults = Object.values(CATEGORY_DEFAULT_ROLES);
    if (!role.value.trim() || knownDefaults.includes(role.value)) {
      role.value = CATEGORY_DEFAULT_ROLES[event.target.value] || '';
    }
  });

  const dropzone = $('dropzone');
  if (dropzone) {
    for (const type of ['dragenter', 'dragover']) {
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dropzone.classList.add('is-over');
      });
    }
    for (const type of ['dragleave', 'dragend']) {
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        if (event.target === dropzone) dropzone.classList.remove('is-over');
      });
    }
    dropzone.addEventListener('drop', async (event) => {
      event.preventDefault();
      dropzone.classList.remove('is-over');
      try {
        const files = await filesFromDrop(event.dataTransfer);
        if (!files.length) {
          showToast('没有读取到文件。', { error: true });
          return;
        }
        setUploadFiles(files);
      } catch (error) {
        showToast(`读取拖入文件失败：${error.message}`, { error: true });
      }
    });
  }

  document.addEventListener('keydown', (event) => {
    const isTyping = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if (event.key === 'Escape') {
      if ($('upload-modal').classList.contains('is-open')) {
        closeModal($('upload-modal'));
      } else if ($('curator-modal').classList.contains('is-open')) {
        closeModal($('curator-modal'));
      } else if ($('viewer').classList.contains('is-open')) {
        closeViewer();
      }
      return;
    }
    if (!isTyping && (event.key === 'r' || event.key === 'R') && $('viewer').classList.contains('is-open')) {
      state.viewer?.reset();
    }
    if (event.key === 'Tab') {
      const modal = qs('.modal.is-open');
      const container = modal || ($('viewer').classList.contains('is-open') ? $('viewer') : null);
      if (!container) return;
      const focusable = getFocusable(container);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  $('viewer')?.addEventListener('pointerdown', (event) => {
    if (event.target === $('viewer')) closeViewer();
  });

  window.addEventListener('hashchange', () => {
    const match = window.location.hash.match(/^#work-(\d{1,2})$/);
    if (match) {
      const slot = Number(match[1]);
      if (currentWork(slot)) openViewer(slot);
    }
  });

  window.addEventListener('pagehide', () => {
    state.hero?.dispose();
    state.viewer?.dispose();
  });
}

async function init() {
  bindEvents();
  try {
    state.data = await fetchData();
    await refreshLocals();
    renderMeta();
    renderAll();

    const startHero = () => {
      try {
        state.hero = initHero($('hero-visual'));
      } catch (error) {
        console.warn('Hero WebGL unavailable:', error);
        $('hero-visual')?.classList.add('hero-webgl--failed');
      }
    };
    if ('requestIdleCallback' in window) requestIdleCallback(startHero, { timeout: 1200 });
    else window.setTimeout(startHero, 300);

    const match = window.location.hash.match(/^#work-(\d{1,2})$/);
    if (match) {
      const slot = Number(match[1]);
      if (currentWork(slot) && !currentWork(slot).isOpen) {
        window.setTimeout(() => openViewer(slot), 250);
      }
    }
  } catch (error) {
    console.error(error);
    showFatal(error);
    showToast(error.message || '初始化失败。', { error: true, duration: 6000 });
  }
}

init();
