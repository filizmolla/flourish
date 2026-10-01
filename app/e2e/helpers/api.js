// Seeds data for E2E specs through the test server's real HTTP API
// (server `dev:test`, port 3001, flourish_test database), the same way the server
// tests do: sign in with Better Auth and send the bearer token it returns.
// Not a spec itself: e2e/jest.config.js only matches *.test.js.
// Runs in Node on the host, so it talks to localhost (not the emulator's
// 10.0.2.2 alias).
const API_URL = 'http://localhost:3001';

// `npm run e2e:test` starts the server and Detox at the same time, so the
// first spec can get here before the server listens.
async function waitForServer(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_URL}/health`);
      if (res.ok) {
        return;
      }
      lastError = new Error(`GET /health returned ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(
    `The E2E test server at ${API_URL} is not up (${lastError?.message}). ` +
      'Start it with `npm run dev:test --prefix ../server`.',
  );
}

async function request(method, urlPath, { token, body } = {}) {
  const res = await fetch(`${API_URL}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      // Node's fetch sends Sec-Fetch-* headers, so Better Auth's CSRF check
      // wants an Origin; the server's own base URL is trusted by default.
      Origin: API_URL,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${urlPath} failed (${res.status}): ${text}`);
  }
  return { res, data: text ? JSON.parse(text) : null };
}

// Returns the bearer token for an existing user (e.g. from createFreshUser).
async function signInApi({ email, password }) {
  const { res } = await request('POST', '/api/auth/sign-in/email', {
    body: { email, password },
  });
  const token = res.headers.get('set-auth-token');
  if (!token) {
    throw new Error('Sign-in succeeded but no set-auth-token header was returned');
  }
  return token;
}

// recipe: { title, ingredients: string[], instructions: string, ... }
async function createRecipeApi(token, recipe) {
  const { data } = await request('POST', '/recipes', { token, body: recipe });
  return data;
}

// attempt: { rating?, notes?, durationMinutes?, ingredients?: [{ text }],
// instructions?, basedOnAttemptId? } (null/omitted lines = unchanged).
async function createAttemptApi(token, recipeId, attempt) {
  const { data } = await request('POST', `/recipes/${recipeId}/attempts`, {
    token,
    body: attempt,
  });
  return data;
}

module.exports = {
  waitForServer,
  signInApi,
  createRecipeApi,
  createAttemptApi,
};
