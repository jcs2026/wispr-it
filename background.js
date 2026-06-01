// background.js — service worker for Wispr It
// Handles Whisper transcription and optional Claude rewrite

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TRANSCRIBE') {
    handleTranscription(message)
      .then((result) => sendResponse({ success: true, text: result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // keep message channel open for async response
  }
});

async function handleTranscription({ audioData, mimeType, enableRewrite }) {
  const { openaiKey, anthropicKey } = await getStoredKeys();

  if (!openaiKey) {
    throw new Error('OpenAI API key not set. Open the extension popup to configure.');
  }

  // Convert base64 audio data back to a Blob
  const binaryStr = atob(audioData);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  const audioBlob = new Blob([bytes], { type: mimeType || 'audio/webm' });

  // --- Step 1: Transcribe with Whisper ---
  const formData = new FormData();
  formData.append('file', new File([audioBlob], 'audio.webm', { type: 'audio/webm' }));
  formData.append('model', 'whisper-1');

  const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiKey}`,
    },
    body: formData,
  });

  if (!whisperRes.ok) {
    const errBody = await whisperRes.text();
    throw new Error(`Whisper API error ${whisperRes.status}: ${errBody}`);
  }

  const whisperData = await whisperRes.json();
  let transcript = whisperData.text || '';

  if (!transcript.trim()) {
    throw new Error('No speech detected in the recording.');
  }

  // --- Step 2 (optional): Clean up with Claude ---
  if (enableRewrite && anthropicKey) {
    transcript = await rewriteWithClaude(transcript, anthropicKey);
  }

  return transcript;
}

async function rewriteWithClaude(text, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system:
        'You are a dictation assistant. Clean up the following spoken text for professional written communication. Fix grammar, remove filler words, and format appropriately. Return only the cleaned text, nothing else.',
      messages: [{ role: 'user', content: text }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    // Fall back to raw transcript rather than failing completely
    console.warn(`Claude API error ${res.status}: ${errBody}. Returning raw transcript.`);
    return text;
  }

  const data = await res.json();
  return data.content?.[0]?.text || text;
}

async function getStoredKeys() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['openaiKey', 'anthropicKey'], (items) => {
      resolve({
        openaiKey: items.openaiKey || '',
        anthropicKey: items.anthropicKey || '',
      });
    });
  });
}
