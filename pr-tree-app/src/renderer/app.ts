import { GitHubClient } from '../github-client';
import { buildPrNodes, filterKeyword, filterCiPass, filterNoApproved, PrNode } from '../pr-builder';
import { buildTree } from '../tree-builder';
import { renderTree, renderGrouped, renderSubTree, findTreeRoot, extractRelatedSubtree } from './tree-view';
import { AppConfig } from '../types';

const CONFIG_KEY = 'pr-tree-config';
const VIEW_MODE_KEY = 'pr-tree-view-mode';

type ViewMode = 'card' | 'tree';

let pollingTimer: ReturnType<typeof setInterval> | null = null;
let client: GitHubClient | null = null;
let currentConfig: AppConfig | null = null;
let currentTree: PrNode[] = [];
let currentNodes: PrNode[] = [];
let viewMode: ViewMode = 'card';
let selectedTreePrNumber: number | null = null;

function loadConfig(): AppConfig | null {
  const raw = localStorage.getItem(CONFIG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
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

function getElements() {
  return {
    repoName: document.getElementById('repo-name')!,
    refreshBtn: document.getElementById('refresh-btn')!,
    settingsBtn: document.getElementById('settings-btn')!,
    settingsPanel: document.getElementById('settings-panel')!,
    tokenInput: document.getElementById('token-input') as HTMLInputElement,
    repoInput: document.getElementById('repo-input') as HTMLInputElement,
    usernameInput: document.getElementById('username-input') as HTMLInputElement,
    intervalInput: document.getElementById('interval-input') as HTMLInputElement,
    saveSettingsBtn: document.getElementById('save-settings-btn')!,
    lastUpdated: document.getElementById('last-updated')!,
    rateLimit: document.getElementById('rate-limit')!,
    treeContainer: document.getElementById('tree-container')!,
    viewCardBtn: document.getElementById('view-card-btn')!,
    viewTreeBtn: document.getElementById('view-tree-btn')!,
    treeDetailPanel: document.getElementById('tree-detail-panel')!,
    treeDetailTitle: document.getElementById('tree-detail-title')!,
    treeDetailContent: document.getElementById('tree-detail-content')!,
    treeDetailClose: document.getElementById('tree-detail-close')!,
  };
}

function renderCurrentView(els: ReturnType<typeof getElements>): void {
  if (currentTree.length === 0 && currentNodes.length === 0) return;

  if (viewMode === 'card' && currentConfig?.username) {
    renderGrouped(els.treeContainer, currentTree, currentConfig.username, (rootNode, highlightNumber) => {
      selectedTreePrNumber = highlightNumber;
      showTreeDetail(els, rootNode, highlightNumber);
    }, selectedTreePrNumber);

    // 選択中のツリー詳細パネルを復元
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
}

async function fetchAndRender(els: ReturnType<typeof getElements>): Promise<void> {
  if (!client) return;

  els.lastUpdated.textContent = 'Loading...';

  try {
    const prs = await client.pullRequests();
    let nodes = buildPrNodes(prs as never[]);
    nodes = filterKeyword(nodes, currentConfig?.username);
    nodes = filterCiPass(nodes, false);
    nodes = filterNoApproved(nodes, false);
    currentNodes = nodes;
    currentTree = buildTree(nodes);

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
  updateViewButtons(els);

  // 設定復元
  if (config) {
    els.tokenInput.value = config.token;
    els.repoInput.value = `${config.owner}/${config.repo}`;
    els.usernameInput.value = config.username || '';
    els.intervalInput.value = String(config.pollingInterval);
    els.repoName.textContent = `${config.owner}/${config.repo}`;
    client = new GitHubClient(config.token, config.owner, config.repo);
    currentConfig = config;
  }

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

  // 設定パネルトグル
  els.settingsBtn.addEventListener('click', () => {
    els.settingsPanel.classList.toggle('hidden');
  });

  // 設定保存
  els.saveSettingsBtn.addEventListener('click', () => {
    const token = els.tokenInput.value.trim();
    const repoParts = els.repoInput.value.trim().split('/');
    const username = els.usernameInput.value.trim() || undefined;
    const interval = parseInt(els.intervalInput.value, 10) || 60;

    if (!token || repoParts.length !== 2) {
      alert('Token and Owner/Repo are required');
      return;
    }

    const newConfig: AppConfig = {
      token,
      owner: repoParts[0],
      repo: repoParts[1],
      pollingInterval: interval,
      username,
    };

    saveConfig(newConfig);
    currentConfig = newConfig;
    client = new GitHubClient(newConfig.token, newConfig.owner, newConfig.repo);
    els.repoName.textContent = `${newConfig.owner}/${newConfig.repo}`;
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
    // ツリーバッジのクリックは無視（専用ハンドラがある）
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
  if (client) {
    fetchAndRender(els);
    startPolling(els, config?.pollingInterval || 60);
  } else {
    els.settingsPanel.classList.remove('hidden');
    els.treeContainer.innerHTML =
      '<div class="loading">Configure token and repository to get started.</div>';
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
