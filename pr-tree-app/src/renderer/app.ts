import { GitHubClient } from '../github-client';
import { buildPrNodes, filterKeyword, filterCiPass, filterNoApproved } from '../pr-builder';
import { buildTree } from '../tree-builder';
import { renderTree } from './tree-view';
import { AppConfig } from '../types';

const CONFIG_KEY = 'pr-tree-config';

let pollingTimer: ReturnType<typeof setInterval> | null = null;
let client: GitHubClient | null = null;
let currentConfig: AppConfig | null = null;

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
  };
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
    const tree = buildTree(nodes);
    renderTree(els.treeContainer, tree);
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

  // 手動更新
  els.refreshBtn.addEventListener('click', () => fetchAndRender(els));

  // リンクをブラウザで開く
  els.treeContainer.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'A' && target.dataset.url) {
      e.preventDefault();
      window.electronAPI.openExternal(target.dataset.url);
    }
  });

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
