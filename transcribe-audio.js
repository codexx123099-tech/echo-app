// Transcribes a voice entry via Google Gemini's audio understanding —
// Gemini accepts audio directly in the same generateContent call used for
// text, so this doesn't need a separate speech-to-text product.
//
// Required environment variable:
//   GEMINI_API_KEY — from aistudio.google.com/apikey (free tier, no card required)
//
// Model: gemini-3.6-flash — the current stable/GA Flash model as of this
// writing. Gemini's older 2.0 Flash line was retired June 2026, and 2.5
// Flash is scheduled to shut down October 2026 — avoid building on either.
// If this model is ever deprecated, check ai.google.dev/gemini-api/docs/models
// for its replacement before swapping the string below.
//
// Note on size: Gemini's inline-data request limit is 20MB total (audio +
// prompt combined). MAX_AUDIO_BYTES below stays under that with headroom.

const GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent';
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  if (!process.env.GEMINI_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Transcription is not configured on the server yet.' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { audioBase64, mimeType } = payload;
  if (!audioBase64) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No audio provided.' }) };
  }

  const approxBytes = Math.ceil(audioBase64.length * 0.75);
  if (approxBytes === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Empty audio.' }) };
  }
  if (approxBytes > MAX_AUDIO_BYTES) {
    return { statusCode: 413, body: JSON.stringify({ error: 'That recording is too long to transcribe in one request — try a shorter entry.' }) };
  }

  try {
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'x-goog-api-key': process.env.GEMINI_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: 'Transcribe this audio exactly as spoken, in the language it is spoken in. Return only the transcript text, nothing else — no preamble, no quotation marks. If no speech is audible, return an empty response.' },
            { inlineData: { mimeType: mimeType || 'audio/webm', data: audioBase64 } },
          ],
        }],
        generationConfig: {
          maxOutputTokens: 2000,
          thinkingConfig: { thinkingLevel: 'minimal' }, // transcription doesn't need reasoning, just speed
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { statusCode: response.status, body: JSON.stringify({ error: 'Transcription failed: ' + errText.slice(0, 200) }) };
    }

    const data = await response.json();
    const transcript = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text) || '';

    return { statusCode: 200, body: JSON.stringify({ transcript: transcript.trim() }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Could not transcribe audio.' }) };
  }
};
