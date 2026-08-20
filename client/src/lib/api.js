// API Utility for Ivent Client

const rawApiUrl = (process.env.NEXT_PUBLIC_API_URL || '').trim().replace(/\/+$/, '');

export function getApiUrl() {
  if (rawApiUrl) {
    return rawApiUrl;
  }
  if (typeof window !== 'undefined') {
    // If running in browser and no NEXT_PUBLIC_API_URL was injected at build time
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'http://localhost:3001';
    }
  }
  return 'http://localhost:3001';
}

function getAuthHeaders() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('ivent_token') : null;
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function safeFetch(url, options = {}) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (networkErr) {
    throw new Error(
      `Cannot connect to backend server at ${url}. If using Render free tier, the backend may be waking up (takes ~30-50 seconds). Please try again shortly.`
    );
  }

  const text = await res.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // The server returned HTML or non-JSON (e.g. 502/503 from Render gateway or a 404 page)
      if (!res.ok) {
        if (res.status === 502 || res.status === 503) {
          throw new Error(
            'Backend server is waking up on Render. Please wait 30 seconds and refresh the page.'
          );
        }
        if (res.status === 404) {
          throw new Error(`Endpoint not found (404) at ${url}. Check your backend service URL.`);
        }
        throw new Error(`Server returned error status ${res.status}.`);
      }
      throw new Error(`Invalid response format from API: ${text.slice(0, 100)}`);
    }
  }

  if (!res.ok) {
    const errorMsg = data?.error || data?.message || `Request failed with status ${res.status}`;
    throw new Error(errorMsg);
  }

  return data || {};
}

export async function apiGet(path) {
  const apiUrl = getApiUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return safeFetch(`${apiUrl}${normalizedPath}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
}

export async function apiPost(path, body) {
  const apiUrl = getApiUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return safeFetch(`${apiUrl}${normalizedPath}`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function apiDelete(path) {
  const apiUrl = getApiUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return safeFetch(`${apiUrl}${normalizedPath}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
}
