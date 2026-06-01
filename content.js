// content.js — hotkey listener, mic recording, overlay UI, text injection

console.log('[Wispr] content script loaded on', location.href);

(function () {
  'use strict';

  // ── State ────────────────────────────────────────────────────────────────────
  let mediaRecorder = null;
  let audioChunks = [];
  let isRecording = false;
  let isProcessing = false;
  let overlayEl = null;
  let focusedElement = null;

  // Default hotkey config
  const DEFAULT_HOTKEY = { key: ' ', ctrl: true, shift: true, meta: false };

  // ── Overlay UI ───────────────────────────────────────────────────────────────
  function createOverlay() {
    if (overlayEl) return;
    overlayEl = document.createElement('div');
    overlayEl.id = 'wispr-overlay';
    overlayEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(overlayEl);
  }

  function setOverlayState(state) {
    createOverlay();
    switch (state) {
      case 'recording':
        overlayEl.className = 'wispr-recording';
        overlayEl.innerHTML = '<span class="wispr-dot"></span> Recording…';
        overlayEl.style.display = 'flex';
        break;
      case 'processing':
        overlayEl.className = 'wispr-processing';
        overlayEl.innerHTML = '⏳ Processing…';
        overlayEl.style.display = 'flex';
        break;
      case 'done':
        overlayEl.className = 'wispr-done';
        overlayEl.innerHTML = '✅ Done';
        overlayEl.style.display = 'flex';
        setTimeout(() => hideOverlay(), 1800);
        break;
      case 'error':
        overlayEl.className = 'wispr-error';
        overlayEl.innerHTML = '❌ Error — check console';
        overlayEl.style.display = 'flex';
        setTimeout(() => hideOverlay(), 3000);
        break;
      default:
        hideOverlay();
    }
  }

  function hideOverlay() {
    if (overlayEl) overlayEl.style.display = 'none';
  }

  // ── Hotkey matching ──────────────────────────────────────────────────────────
  function matchesHotkey(e, hotkey) {
    const key = hotkey.key || ' ';
    const ctrl = hotkey.ctrl !== undefined ? hotkey.ctrl : true;
    const shift = hotkey.shift !== undefined ? hotkey.shift : true;
    const meta = hotkey.meta !== undefined ? hotkey.meta : false;

    // On Mac, Cmd replaces Ctrl
    const ctrlOrCmd = e.ctrlKey || e.metaKey;

    return (
      e.code === 'Space' &&
      ctrlOrCmd === ctrl &&
      e.shiftKey === shift
    );
  }

  // ── Recording ────────────────────────────────────────────────────────────────
  async function startRecording() {
    if (isRecording || isProcessing) return;

    // Capture the currently focused element before getUserMedia steals focus
    focusedElement = document.activeElement;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];

      // Prefer webm/opus; fall back to whatever the browser supports
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';

      const options = mimeType ? { mimeType } : {};
      mediaRecorder = new MediaRecorder(stream, options);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.start(100); // collect chunks every 100ms
      isRecording = true;
      setOverlayState('recording');
    } catch (err) {
      console.error('[Wispr] Microphone access denied:', err);
      setOverlayState('error');
    }
  }

  async function stopRecordingAndTranscribe() {
    if (!isRecording || !mediaRecorder) return;

    isRecording = false;
    isProcessing = true;
    setOverlayState('processing');

    await new Promise((resolve) => {
      mediaRecorder.onstop = resolve;
      mediaRecorder.stop();
      // Stop all tracks to release mic indicator
      mediaRecorder.stream.getTracks().forEach((t) => t.stop());
    });

    const mimeType = mediaRecorder.mimeType || 'audio/webm';
    const audioBlob = new Blob(audioChunks, { type: mimeType });
    audioChunks = [];
    mediaRecorder = null;

    if (audioBlob.size < 500) {
      // Too small — likely silence
      isProcessing = false;
      setOverlayState('error');
      return;
    }

    // Convert blob to base64 to send via chrome.runtime.sendMessage
    const base64 = await blobToBase64(audioBlob);

    // Read settings for rewrite flag
    const settings = await getSettings();

    chrome.runtime.sendMessage(
      {
        type: 'TRANSCRIBE',
        audioData: base64,
        mimeType,
        enableRewrite: settings.enableRewrite || false,
      },
      (response) => {
        isProcessing = false;
        if (chrome.runtime.lastError) {
          console.error('[Wispr] Runtime error:', chrome.runtime.lastError.message);
          setOverlayState('error');
          return;
        }
        if (response && response.success) {
          injectText(response.text);
          setOverlayState('done');
        } else {
          console.error('[Wispr] Transcription failed:', response?.error);
          setOverlayState('error');
        }
      }
    );
  }

  // ── Text injection ───────────────────────────────────────────────────────────
  function injectText(text) {
    const el = focusedElement;
    if (!el || !text) return;

    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    const isInput = tag === 'input' || tag === 'textarea';
    const isContentEditable =
      el.isContentEditable || el.getAttribute('contenteditable') === 'true';

    if (isInput) {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const before = el.value.slice(0, start);
      const after = el.value.slice(end);
      // Insert with a space separator if there's preceding text
      const separator = before.length > 0 && !before.endsWith(' ') ? ' ' : '';
      el.value = before + separator + text + after;
      const newCursor = start + separator.length + text.length;
      el.selectionStart = newCursor;
      el.selectionEnd = newCursor;
      // Trigger framework reactivity
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.focus();
    } else if (isContentEditable) {
      el.focus();
      // Use execCommand for broad compatibility with rich text editors
      const success = document.execCommand('insertText', false, text);
      if (!success) {
        // Fallback: insert at end of text content
        const textNode = document.createTextNode(text);
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          range.insertNode(textNode);
          range.setStartAfter(textNode);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          el.appendChild(textNode);
        }
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      console.warn('[Wispr] Focused element is not an editable field:', el);
    }
  }

  // ── Utilities ────────────────────────────────────────────────────────────────
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        // result is "data:<mime>;base64,<data>" — strip the prefix
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function getSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['enableRewrite', 'hotkey'], (items) => resolve(items));
    });
  }

  // ── Keyboard listeners ───────────────────────────────────────────────────────
  document.addEventListener(
    'keydown',
    (e) => {
      // Only Ctrl/Cmd + Shift + Space
      if (!((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'Space')) return;

      e.preventDefault();
      e.stopPropagation();

      if (isProcessing) return;

      if (isRecording) {
        // Second press = stop
        stopRecordingAndTranscribe();
      } else {
        startRecording();
      }
    },
    true // capture phase so we beat site handlers
  );

  document.addEventListener(
    'keyup',
    (e) => {
      if (!((e.ctrlKey || e.metaKey || e.code === 'ControlLeft' || e.code === 'MetaLeft') &&
            e.code !== 'ShiftLeft' && e.code !== 'ShiftRight')) {
        // Only stop on hotkey release when still recording
        // We stop on keyup of Space while recording
        if (e.code === 'Space' && isRecording) {
          e.preventDefault();
          stopRecordingAndTranscribe();
        }
      }
    },
    true
  );

  // Create overlay container at init
  createOverlay();
})();
