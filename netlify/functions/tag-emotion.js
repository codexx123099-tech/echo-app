// Classifies the dominant emotion in a journal transcript via Google Gemini.
// Client sends { transcript } — returns one of Echo's emotion tags.
//
// Required environment variable:
//   GEMINI_API_KEY — same key used by transcribe-audio.js
//
// Model: gemini-3.6-flash — see the comment in transcribe-audio.js for why
// this specific model, and what to check if it's ever deprecated.
//
// IMPORTANT: EMOTIONS below must stay in sync with the EMOTIONS array in
// index.html — if an emotion is ever added/removed there, update it here too.

const EMOTIONS = ['Anxiety', 'Joy', 'Frustration', 'Curiosity', 'Neutral', 'Sadness', 'Gratitude', 'Excitement', 'Calm', 'Anger'];
const GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  if (!process.env.GEMINI_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Emotion tagging is not configured on the server yet.' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const transcript = (payload.transcript || '').trim();
  if (!transcript) {
    // Nothing to classify (e.g. a voice entry where no speech was
    // captured) — skip the API call entirely rather than spend a
    // request on empty input.
    return { statusCode: 200, body: JSON.stringify({ emotion: 'Neutral' }) };
  }

  try {
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'x-goog-api-key': process.env.GEMINI_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text:
              'You classify the dominant emotion in a personal journal entry. ' +
              'Respond with exactly one word from this list, nothing else: ' +
              EMOTIONS.join(', ') + '. ' +
              'Pick "Neutral" if nothing else clearly fits.',
          }],
        },
        contents: [{ parts: [{ text: transcript.slice(0, 4000) }] }], // keeps the prompt bounded regardless of entry length
        generationConfig: {
          maxOutputTokens: 10,
          // "minimal" is Gemini's recommended setting for high-volume
          // classification/extraction — no need for step-by-step reasoning
          // to pick one word off a fixed list.
          thinkingConfig: { thinkingLevel: 'minimal' },
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { statusCode: response.status, body: JSON.stringify({ error: 'Emotion tagging failed: ' + errText.slice(0, 200) }) };
    }

    const data = await response.json();
    const raw = ((data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text) || '').trim();
    // Guards against the model ever returning something outside the
    // fixed list — falls back to Neutral rather than passing through
    // an emotion the rest of the app doesn't know how to render.
    const emotion = EMOTIONS.find(e => e.toLowerCase() === raw.toLowerCase()) || 'Neutral';

    return { statusCode: 200, body: JSON.stringify({ emotion }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Could not classify emotion.' }) };
  }
};
