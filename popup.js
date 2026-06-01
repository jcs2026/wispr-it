// popup.js — settings page logic

(function () {
  'use strict';

  const DEFAULT_HOTKEY_LABEL = 'Ctrl + Shift + Space';

  const form = document.getElementById('settings-form');
  const openaiKeyInput = document.getElementById('openai-key');
  const anthropicKeyInput = document.getElementById('anthropic-key');
  const enableRewriteCheckbox = document.getElementById('enable-rewrite');
  const hotkeyLabel = document.getElementById('hotkey-label');
  const resetHotkeyBtn = document.getElementById('reset-hotkey');
  const saveMsg = document.getElementById('save-msg');

  // ── Load saved settings ────────────────────────────────────────────────────
  chrome.storage.sync.get(
    ['openaiKey', 'anthropicKey', 'enableRewrite', 'hotkeyLabel'],
    (items) => {
      if (items.openaiKey) openaiKeyInput.value = items.openaiKey;
      if (items.anthropicKey) anthropicKeyInput.value = items.anthropicKey;
      enableRewriteCheckbox.checked = items.enableRewrite || false;
      hotkeyLabel.textContent = items.hotkeyLabel || DEFAULT_HOTKEY_LABEL;
    }
  );

  // ── Save on submit ─────────────────────────────────────────────────────────
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    saveSettings();
  });

  // Also auto-save checkbox immediately on change
  enableRewriteCheckbox.addEventListener('change', () => saveSettings(false));

  function saveSettings(showConfirmation = true) {
    chrome.storage.sync.set(
      {
        openaiKey: openaiKeyInput.value.trim(),
        anthropicKey: anthropicKeyInput.value.trim(),
        enableRewrite: enableRewriteCheckbox.checked,
      },
      () => {
        if (showConfirmation) showSaved();
      }
    );
  }

  function showSaved() {
    saveMsg.textContent = 'Saved!';
    saveMsg.classList.add('visible');
    setTimeout(() => {
      saveMsg.textContent = '';
      saveMsg.classList.remove('visible');
    }, 2000);
  }

  // ── Reset hotkey ───────────────────────────────────────────────────────────
  resetHotkeyBtn.addEventListener('click', () => {
    chrome.storage.sync.set({ hotkeyLabel: DEFAULT_HOTKEY_LABEL }, () => {
      hotkeyLabel.textContent = DEFAULT_HOTKEY_LABEL;
      showSaved();
    });
  });

  // ── Show/hide password toggles ─────────────────────────────────────────────
  document.querySelectorAll('.toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.textContent = input.type === 'password' ? '👁' : '🙈';
    });
  });
})();
