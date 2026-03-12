import { GitHubClient } from '../github-client';
import { buildPrNodes, filterKeyword, filterCiPass, filterNoApproved, PrNode } from '../pr-builder';
import { buildTree } from '../tree-builder';
import { renderTree, renderGrouped, renderSubTree, findTreeRoot, extractRelatedSubtree } from './tree-view';
import { AppConfig, RepoEntry } from '../types';

const CONFIG_KEY = 'pr-tree-config';
const VIEW_MODE_KEY = 'pr-tree-view-mode';
const HIDE_APPROVED_KEY = 'pr-tree-hide-approved';

type ViewMode = 'card' | 'tree';

let pollingTimer: ReturnType<typeof setInterval> | null = null;
let clients: { client: GitHubClient; repoFullName: string }[] = [];
let currentConfig: AppConfig | null = null;
let currentTree: PrNode[] = [];
let currentNodes: PrNode[] = [];
let viewMode: ViewMode = 'card';
let selectedTreePrNumber: number | null = null;
let settingsRepos: RepoEntry[] = [];
let hideApproved = false;
let lastFetchedNodes: PrNode[] = [];

function loadConfig(): AppConfig | null {
  const raw = localStorage.getItem(CONFIG_KEY);
  if (!raw) return null;
  try {
    const config = JSON.parse(raw) as AppConfig;
    // 旧形式（owner/repo 単体）からの移行
    if (!config.repos && config.owner && config.repo) {
      config.repos = [{ owner: config.owner, repo: config.repo }];
    }
    if (!config.repos) config.repos = [];
    return config;
  } catch {
    return null;
  }
}

function saveConfig(config: AppConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

function loadViewMode(): ViewMode {
  return (localStorage.getItem(VIEW_MODE_KEY) as ViewMode) || 'card';
}

function saveViewMode(mode: ViewMode): void {
  localStorage.setItem(VIEW_MODE_KEY, mode);
}

function buildClients(config: AppConfig): typeof clients {
  return config.repos.map((r) => ({
    client: new GitHubClient(config.token, r.owner, r.repo),
    repoFullName: `${r.owner}/${r.repo}`,
  }));
}

function getElements() {
  return {
    repoName: document.getElementById('repo-name')!,
    refreshBtn: document.getElementById('refresh-btn')!,
    settingsBtn: document.getElementById('settings-btn')!,
    settingsPanel: document.getElementById('settings-panel')!,
    tokenInput: document.getElementById('token-input') as HTMLInputElement,
    reposList: document.getElementById('repos-list')!,
    repoAddInput: document.getElementById('repo-add-input') as HTMLInputElement,
    repoAddBtn: document.getElementById('repo-add-btn')!,
    usernameInput: document.getElementById('username-input') as HTMLInputElement,
    intervalInput: document.getElementById('interval-input') as HTMLInputElement,
    saveSettingsBtn: document.getElementById('save-settings-btn')!,
    lastUpdated: document.getElementById('last-updated')!,
    rateLimit: document.getElementById('rate-limit')!,
    treeContainer: document.getElementById('tree-container')!,
    viewCardBtn: document.getElementById('view-card-btn')!,
    viewTreeBtn: document.getElementById('view-tree-btn')!,
    hideApprovedBtn: document.getElementById('hide-approved-btn')!,
    treeDetailPanel: document.getElementById('tree-detail-panel')!,
    treeDetailTitle: document.getElementById('tree-detail-title')!,
    treeDetailContent: document.getElementById('tree-detail-content')!,
    treeDetailClose: document.getElementById('tree-detail-close')!,
  };
}

function renderReposList(els: ReturnType<typeof getElements>): void {
  els.reposList.innerHTML = '';
  settingsRepos.forEach((r, i) => {
    const item = document.createElement('div');
    item.className = 'repo-item';
    item.innerHTML =
      `<span class="repo-status" data-repo-index="${i}">⏳</span>` +
      `<span>${r.owner}/${r.repo}</span>` +
      `<button class="repo-remove-btn" data-index="${i}" title="Remove">✕</button>`;
    item.querySelector('.repo-remove-btn')!.addEventListener('click', () => {
      settingsRepos.splice(i, 1);
      renderReposList(els);
    });
    els.reposList.appendChild(item);

    // 疎通チェック
    const token = els.tokenInput.value.trim();
    if (token) {
      const client = new GitHubClient(token, r.owner, r.repo);
      client.checkConnection().then((ok) => {
        const badge = els.reposList.querySelector(`[data-repo-index="${i}"]`);
        if (badge) badge.textContent = ok ? '✅' : '❌';
      });
    }
  });
}

function repoNameText(config: AppConfig): string {
  if (config.repos.length === 0) return '';
  if (config.repos.length === 1) return `${config.repos[0].owner}/${config.repos[0].repo}`;
  return `${config.repos[0].owner}/${config.repos[0].repo} +${config.repos.length - 1}`;
}

function renderCurrentView(els: ReturnType<typeof getElements>): void {
  if (currentTree.length === 0 && currentNodes.length === 0) return;

  if (viewMode === 'card' && currentConfig?.username) {
    renderGrouped(els.treeContainer, currentTree, currentConfig.username, (rootNode, highlightNumber) => {
      selectedTreePrNumber = highlightNumber;
      showTreeDetail(els, rootNode, highlightNumber);
    }, selectedTreePrNumber, hideApproved);

    if (selectedTreePrNumber != null) {
      restoreTreeDetail(els);
    } else {
      els.treeDetailPanel.classList.add('hidden');
    }
  } else {
    selectedTreePrNumber = null;
    els.treeDetailPanel.classList.add('hidden');
    renderTree(els.treeContainer, currentTree);
  }
}

function showTreeDetail(els: ReturnType<typeof getElements>, rootNode: PrNode, highlightNumber?: number): void {
  els.treeDetailPanel.classList.remove('hidden');
  els.treeDetailTitle.textContent = `🌳 [${rootNode.params.head}]`;
  renderSubTree(els.treeDetailContent, rootNode, highlightNumber);
}

function restoreTreeDetail(els: ReturnType<typeof getElements>): void {
  if (selectedTreePrNumber == null) return;

  const node = findNodeByNumber(currentTree, selectedTreePrNumber);
  if (!node) {
    selectedTreePrNumber = null;
    els.treeDetailPanel.classList.add('hidden');
    return;
  }

  const root = findTreeRoot(currentTree, node);
  if (root) {
    const subtree = extractRelatedSubtree(root, node);
    if (subtree) {
      showTreeDetail(els, subtree, selectedTreePrNumber);
    }
  }
}

function findNodeByNumber(trees: PrNode[], number: number): PrNode | null {
  for (const tree of trees) {
    if (tree.params.number === number) return tree;
    const found = findNodeByNumber(tree.children, number);
    if (found) return found;
  }
  return null;
}

function updateViewButtons(els: ReturnType<typeof getElements>): void {
  els.viewCardBtn.classList.toggle('active', viewMode === 'card');
  els.viewTreeBtn.classList.toggle('active', viewMode === 'tree');
  els.hideApprovedBtn.classList.toggle('active', hideApproved);
}

function applyFiltersAndBuildTree(): void {
  let nodes = [...lastFetchedNodes];
  nodes = filterKeyword(nodes, currentConfig?.username);
  nodes = filterCiPass(nodes, false);
  // hideApproved はカードの Review Requested セクションのみに適用するため、ここでは適用しない
  currentNodes = nodes;
  currentTree = buildTree(nodes);
}

async function fetchAndRender(els: ReturnType<typeof getElements>): Promise<void> {
  if (clients.length === 0) return;

  els.lastUpdated.textContent = 'Loading...';

  try {
    const results = await Promise.all(
      clients.map(async ({ client, repoFullName }) => {
        const prs = await client.pullRequests();
        return buildPrNodes(prs as never[], repoFullName);
      })
    );

    lastFetchedNodes = results.flat();
    applyFiltersAndBuildTree();

    renderCurrentView(els);
    els.lastUpdated.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    els.treeContainer.innerHTML = `<div class="error">Error: ${err}</div>`;
  }
}

function startPolling(els: ReturnType<typeof getElements>, intervalSec: number): void {
  if (pollingTimer) clearInterval(pollingTimer);
  pollingTimer = setInterval(() => fetchAndRender(els), intervalSec * 1000);
}

function init(): void {
  const els = getElements();
  const config = loadConfig();
  viewMode = loadViewMode();
  hideApproved = localStorage.getItem(HIDE_APPROVED_KEY) === 'true';
  updateViewButtons(els);

  // 設定復元
  if (config) {
    els.tokenInput.value = config.token;
    settingsRepos = [...config.repos];
    renderReposList(els);
    els.usernameInput.value = config.username || '';
    els.intervalInput.value = String(config.pollingInterval);
    els.repoName.textContent = repoNameText(config);
    clients = buildClients(config);
    currentConfig = config;
  }

  // リポジトリ追加
  const addRepo = () => {
    const value = els.repoAddInput.value.trim();
    const parts = value.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return;
    // 重複チェック
    if (settingsRepos.some((r) => r.owner === parts[0] && r.repo === parts[1])) return;
    settingsRepos.push({ owner: parts[0], repo: parts[1] });
    els.repoAddInput.value = '';
    renderReposList(els);
  };

  els.repoAddBtn.addEventListener('click', addRepo);
  els.repoAddInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addRepo();
  });

  // ビュー切り替え
  els.viewCardBtn.addEventListener('click', () => {
    viewMode = 'card';
    saveViewMode(viewMode);
    updateViewButtons(els);
    renderCurrentView(els);
  });

  els.viewTreeBtn.addEventListener('click', () => {
    viewMode = 'tree';
    saveViewMode(viewMode);
    updateViewButtons(els);
    renderCurrentView(els);
  });

  // 承認済みPR非表示トグル
  els.hideApprovedBtn.addEventListener('click', () => {
    hideApproved = !hideApproved;
    localStorage.setItem(HIDE_APPROVED_KEY, String(hideApproved));
    updateViewButtons(els);
    applyFiltersAndBuildTree();
    renderCurrentView(els);
  });

  // 設定パネルトグル
  els.settingsBtn.addEventListener('click', () => {
    els.settingsPanel.classList.toggle('hidden');
  });

  // 設定保存
  els.saveSettingsBtn.addEventListener('click', () => {
    // 入力欄に値が残っていたら自動追加
    addRepo();

    const token = els.tokenInput.value.trim();
    const username = els.usernameInput.value.trim() || undefined;
    const interval = parseInt(els.intervalInput.value, 10) || 60;

    if (!token || settingsRepos.length === 0) {
      alert('Token and at least one repository are required');
      return;
    }

    const newConfig: AppConfig = {
      token,
      repos: [...settingsRepos],
      pollingInterval: interval,
      username,
    };

    saveConfig(newConfig);
    currentConfig = newConfig;
    clients = buildClients(newConfig);
    els.repoName.textContent = repoNameText(newConfig);
    els.settingsPanel.classList.add('hidden');

    fetchAndRender(els);
    startPolling(els, newConfig.pollingInterval);
  });

  // ツリー詳細パネルを閉じる
  els.treeDetailClose.addEventListener('click', () => {
    selectedTreePrNumber = null;
    els.treeDetailPanel.classList.add('hidden');
    els.treeContainer.querySelectorAll('.pr-card.pr-highlight').forEach((el) => {
      el.classList.remove('pr-highlight');
    });
  });

  // 手動更新
  els.refreshBtn.addEventListener('click', () => fetchAndRender(els));

  // クリックでブラウザを開く（data-url を持つ要素、または親要素）
  const handleUrlClick = (e: Event) => {
    const target = e.target as HTMLElement;
    if (target.closest('.tree-badge')) return;
    const clickable = target.closest('[data-url]') as HTMLElement | null;
    if (clickable?.dataset.url) {
      e.preventDefault();
      window.electronAPI.openExternal(clickable.dataset.url);
    }
  };
  els.treeContainer.addEventListener('click', handleUrlClick);
  els.treeDetailContent.addEventListener('click', handleUrlClick);

  // 初回読み込み
  if (clients.length > 0) {
    fetchAndRender(els);
    startPolling(els, config?.pollingInterval || 60);
  } else {
    els.settingsPanel.classList.remove('hidden');
    els.treeContainer.innerHTML =
      '<div class="loading">Configure token and repositories to get started.</div>';
  }
}

// electronAPI の型定義
declare global {
  interface Window {
    electronAPI: {
      openExternal: (url: string) => void;
    };
  }
}

document.addEventListener('DOMContentLoaded', init);
