// API Utility for Ivent Client

export function getApiUrl() {
  let url = (process.env.NEXT_PUBLIC_API_URL || '').trim().replace(/\/+$/, '');

  // If URL is set, normalize it
  if (url) {
    // If it's a hostname without protocol (e.g. "ivent-api.onrender.com" or "ivent-api")
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }

    // If it's an internal Render service name like https://ivent-api (missing .onrender.com)
    try {
      const parsed = new URL(url);
      if (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost') {
        // Single word hostname on Render -> append .onrender.com
        url = `https://${parsed.hostname}.onrender.com`;
      }
    } catch {
      if (!url.includes('.') && !url.includes('localhost')) {
        url = `https://${url.replace(/^https?:\/\//, '')}.onrender.com`;
      }
    }
    return url;
  }

  // If in browser and no env variable was injected at build time
  if (typeof window !== 'undefined') {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'http://localhost:3001';
    }
    // If running on Render (*.onrender.com), auto-detect backend by replacing client with api
    if (window.location.hostname.endsWith('.onrender.com')) {
      const host = window.location.hostname;
      const apiHost = host.replace(/-client\./, '-api.').replace(/client\./, 'api.');
      return `https://${apiHost}`;
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
      `Cannot connect to backend server at ${url}. If using Render free tier, the backend may be waking up (takes ~30-50 seconds). Please wait and refresh.`
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
