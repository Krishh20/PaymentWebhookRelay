export async function apiGet(path, { signal } = {}) {
  const response = await fetch(path, {
    signal,
    cache: "no-store",
    headers: { accept: "application/json" },
  });

  let body = null;

  try {
    body = await response.json();
  } catch {
    // Some errors have no JSON body.
  }

  if (!response.ok) {
    const message =
      body?.error?.message || `Request failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  return body?.data;
}

export function queryString(params) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }

    const text = String(value).trim();

    if (text !== "") {
      search.set(key, text);
    }
  }

  const result = search.toString();
  return result ? `?${result}` : "";
}
