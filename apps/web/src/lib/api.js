/*
  API client.

  One place that knows about the base URL, the auth header, token
  refresh and error shapes. Screens call the named helpers at the bottom
  and never touch fetch directly, so adding a header or changing the
  error contract is a single edit.

  Requests go to a relative path and Vite proxies them to the API in
  development (see vite.config.js). That keeps CORS out of the loop
  locally and means the same build works when the two are served from
  one origin in production.
*/

const BASE = import.meta.env.VITE_API_URL ?? "/api/v1";

const ACCESS_KEY = "cc.access";
const REFRESH_KEY = "cc.refresh";

/* ------------------------------------------------------------------ */
/* Token storage                                                       */
/* ------------------------------------------------------------------ */

/*
  sessionStorage, not localStorage. A token that outlives the tab is a
  token that outlives the person walking away from a shared classroom
  machine, which is exactly the environment this product runs in.
*/
export const tokens = {
  get access() {
    try {
      return sessionStorage.getItem(ACCESS_KEY);
    } catch {
      return null;
    }
  },
  get refresh() {
    try {
      return sessionStorage.getItem(REFRESH_KEY);
    } catch {
      return null;
    }
  },
  set({ accessToken, refreshToken }) {
    try {
      sessionStorage.setItem(ACCESS_KEY, accessToken);
      if (refreshToken) sessionStorage.setItem(REFRESH_KEY, refreshToken);
    } catch {
      /* Private mode. The session simply will not survive a reload. */
    }
  },
  clear() {
    try {
      sessionStorage.removeItem(ACCESS_KEY);
      sessionStorage.removeItem(REFRESH_KEY);
    } catch {
      /* Nothing to clear. */
    }
  },
};

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export class ApiError extends Error {
  constructor(status, detail, body) {
    super(typeof detail === "string" ? detail : (detail?.error ?? "Request failed"));
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.body = body;
  }

  /* A tier gate refusal, so the screen can show an upgrade state. */
  get isPaywall() {
    return this.status === 402;
  }

  /* An administrator has switched this page off for the caller's role. */
  get isPageBlocked() {
    return this.status === 403 && this.detail?.error === "page_not_permitted";
  }

  get isAuth() {
    return this.status === 401;
  }

  get feature() {
    return this.detail?.feature ?? null;
  }

  get requiredTier() {
    return this.detail?.required_tier ?? this.detail?.requiredTier ?? null;
  }
}

/* ------------------------------------------------------------------ */
/* Core request                                                        */
/* ------------------------------------------------------------------ */

let refreshInFlight = null;

async function refreshAccessToken() {
  /*
    Collapse concurrent refreshes. A dashboard fires several requests on
    first paint, and without this an expired token would trigger one
    refresh per request and the losers would use a rotated token.
  */
  if (refreshInFlight) return refreshInFlight;

  const token = tokens.refresh;
  if (!token) return null;

  refreshInFlight = (async () => {
    try {
      const res = await fetch(
        `${BASE}/auth/refresh?refresh_token=${encodeURIComponent(token)}`,
        { method: "POST" },
      );
      if (!res.ok) return null;
      const body = await res.json();
      tokens.set(body);
      return body.accessToken;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function request(path, { method = "GET", body, signal, retry = true } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const access = tokens.access;
  if (access) headers.Authorization = `Bearer ${access}`;

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    // Network level. Distinguished from an API error so the UI can say
    // "cannot reach the server" rather than "something went wrong".
    throw new ApiError(0, "Cannot reach the server. Is the API running?");
  }

  if (res.status === 401 && retry && tokens.refresh) {
    const fresh = await refreshAccessToken();
    if (fresh) return request(path, { method, body, signal, retry: false });
    tokens.clear();
  }

  if (res.status === 204) return null;

  let payload = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, payload?.detail ?? payload ?? res.statusText, payload);
  }
  return payload;
}

export const api = {
  get: (path, opts) => request(path, { ...opts, method: "GET" }),
  post: (path, body, opts) => request(path, { ...opts, method: "POST", body }),
  patch: (path, body, opts) => request(path, { ...opts, method: "PATCH", body }),
  put: (path, body, opts) => request(path, { ...opts, method: "PUT", body }),
  del: (path, opts) => request(path, { ...opts, method: "DELETE" }),
};

/* ------------------------------------------------------------------ */
/* Endpoints                                                           */
/* ------------------------------------------------------------------ */

function qs(params) {
  const clean = Object.entries(params ?? {}).filter(
    ([, v]) => v !== undefined && v !== null && v !== "" && v !== "all",
  );
  if (!clean.length) return "";
  return `?${new URLSearchParams(clean).toString()}`;
}

export const auth = {
  /*
    Returns either a session or a demand for the second factor.

    Tokens are only stored on the first branch. Storing anything on the
    challenge branch would be the bug that makes 2FA decorative: the
    challenge token is not an access token and the server refuses it
    everywhere else, but a client that put it in the session slot would
    still act as though it had signed somebody in.
  */
  async login({ email, password, orgSlug }) {
    const res = await api.post("/auth/login", { email, password, orgSlug });
    if (res.twoFactorRequired) return res;
    tokens.set(res);
    return res;
  },
  async completeTwoFactor({ challengeToken, code, recoveryCode }) {
    const pair = await api.post("/auth/2fa/verify", {
      challengeToken,
      code: code || null,
      recoveryCode: recoveryCode || null,
    });
    tokens.set(pair);
    return pair;
  },
  async signup(body) {
    const res = await api.post("/auth/signup", body);
    tokens.set(res.tokens);
    return res;
  },
  session: () => api.get("/auth/session"),
  /* Two factor enrolment. See app/core/totp.py for the state machine:
     a secret without a confirmation is an abandoned setup, not an
     account that demands a code. */
  twoFactorSetup: () => api.post("/auth/2fa/setup"),
  twoFactorEnable: (code) => api.post("/auth/2fa/enable", { code }),
  twoFactorDisable: (password) => api.post("/auth/2fa/disable", { password }),
  regenerateRecoveryCodes: (password) => api.post("/auth/2fa/recovery-codes", { password }),
  /* Your own account only. There is no user id in either signature,
     because neither endpoint can act on anybody else. */
  updateProfile: (body) => api.patch("/auth/me", body),
  changePassword: (body) => api.post("/auth/change-password", body),
  logout() {
    tokens.clear();
  },
};

/*
  Downloads.

  A CSV arrives as a file, not JSON, so it cannot go through the shared
  request helper: it needs the blob and the filename the server chose in
  Content-Disposition. Doing this with a plain <a download> instead would
  drop the Authorization header and get a 401.
*/
export async function downloadCsv(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {},
  });
  if (!res.ok) {
    let detail = "Could not export that.";
    try {
      detail = (await res.json())?.detail ?? detail;
    } catch {
      /* Not JSON. Keep the generic message. */
    }
    throw new ApiError(res.status, detail);
  }

  const name =
    /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ??
    "export.csv";
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  /* Revoked on the next tick, so the click has taken the URL first. */
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return name;
}

/* Batches are read by teachers and written by admins. The role split
   is enforced on the server; this object just names the calls. */
/*
  File upload and download.

  Neither can go through the shared request helper: one sends multipart
  rather than JSON, the other returns bytes. Both still carry the bearer
  token, which is why a plain <a href> would not do for the download
  either.
*/
export async function uploadContentFile(contentId, file, onProgress) {
  const form = new FormData();
  form.append("file", file);

  /* XHR rather than fetch, only because fetch has no upload progress
     and a lecture recording is big enough that a silent wait reads as
     a hang. */
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/teacher/content/${contentId}/file`);
    if (tokens.access) xhr.setRequestHeader("Authorization", `Bearer ${tokens.access}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* Keep body null and fall through to the generic message. */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new ApiError(xhr.status, body?.detail ?? "Upload failed."));
    };
    xhr.onerror = () => reject(new ApiError(0, "Cannot reach the server."));
    xhr.send(form);
  });
}

/* The URL a player or an <img> can point at. Opened through openFile
   below rather than used directly, because it needs the token. */
export function contentFileUrl(contentId) {
  return `${BASE}/content/${contentId}/file`;
}

export async function openContentFile(contentId, { download = false } = {}) {
  const res = await fetch(contentFileUrl(contentId), {
    headers: tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {},
  });
  if (!res.ok) {
    let detail = "That file could not be opened.";
    try {
      detail = (await res.json())?.detail ?? detail;
    } catch {
      /* Not JSON. */
    }
    throw new ApiError(res.status, detail);
  }
  const name =
    /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "file";
  const url = URL.createObjectURL(await res.blob());
  if (download) {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } else {
    window.open(url, "_blank", "noopener");
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return name;
}

/* The organisation logo, which sits behind an authenticated endpoint
   and so cannot be a plain <img src>. */
export async function uploadOrgLogo(file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/admin/branding/logo`, {
    method: "POST",
    headers: tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {},
    body: form,
  });
  if (!res.ok) {
    let detail = "That logo could not be uploaded.";
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail : detail;
    } catch {
      /* Not JSON. */
    }
    throw new ApiError(res.status, detail);
  }
  return res.json();
}

/* Your own organisation's logo.

   The `version` is in the query string for one reason, and it is not
   cosmetic. This route carries no organisation id by design: the org
   comes from the session, which is what makes it impossible to ask for
   somebody else's. The cost of that design is that every tenant reads
   its logo from the *same URL*, and a URL is the browser's cache key.
   Marked cacheable, one tenant's image was served out of the local HTTP
   cache to the next tenant signing in on that browser, with no request
   reaching the server at all. Hard refreshing appeared to fix it,
   because that is what bypasses the HTTP cache.

   The server now sends no-store on this route, which is the actual fix.
   The version stays as the second line of defence: it makes the cache
   key differ per organisation and per upload, so a cache that ignores
   no-store still cannot serve the wrong image. */
export async function fetchLogo(version) {
  const url = version
    ? `${BASE}/branding/logo?v=${encodeURIComponent(version)}`
    : `${BASE}/branding/logo`;
  const res = await fetch(url, {
    headers: tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {},
    cache: "no-store",
  });
  if (!res.ok) throw new ApiError(res.status, "No logo");
  return URL.createObjectURL(await res.blob());
}

/* Any tenant's logo, for the platform screens. A cross tenant read, so
   the server guards it with require_platform_access rather than the
   super_admin role alone. */
export async function fetchTenantLogo(orgId, version) {
  /* This URL does name the organisation, so it cannot collide across
     tenants the way the route above could. The version is here to stop
     a replaced logo being served from cache for another five minutes. */
  const base = `${BASE}/platform/branding/${orgId}/logo`;
  const res = await fetch(version ? `${base}?v=${encodeURIComponent(version)}` : base, {
    headers: tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, "No logo");
  return URL.createObjectURL(await res.blob());
}

/* The operating company's own logo. Separate from a tenant's, and from
   the ClassConnect product mark, which is not uploaded at all. */
export async function uploadPlatformLogo(file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/platform/branding/logo`, {
    method: "POST",
    headers: tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {},
    body: form,
  });
  if (!res.ok) {
    let detail = "That logo could not be uploaded.";
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail : detail;
    } catch {
      /* Not JSON. */
    }
    throw new ApiError(res.status, detail);
  }
  return res.json();
}

export const batchApi = {
  list: (includeArchived = false) =>
    api.get(`/batches${qs({ include_archived: includeArchived || undefined })}`),
  create: (body) => api.post("/batches", body),
  update: (id, body) => api.patch(`/batches/${id}`, body),
  remove: (id) => api.del(`/batches/${id}`),
};

export const exportApi = {
  people: () => downloadCsv("/exports/people"),
  payments: () => downloadCsv("/exports/payments"),
  attendance: () => downloadCsv("/exports/attendance"),
  audit: () => downloadCsv("/exports/audit"),
  quiz: (id) => downloadCsv(`/exports/quiz/${id}`),
  tenants: () => downloadCsv("/exports/platform/tenants"),
};

export const teacherApi = {
  overview: () => api.get("/teacher/overview"),
  analytics: () => api.get("/teacher/analytics"),
  content: (params) => api.get(`/teacher/content${qs(params)}`),
  createContent: (body) => api.post("/teacher/content", body),
  students: (params) => api.get(`/teacher/students${qs(params)}`),
  createStudent: (body) => api.post("/teacher/students", body),
  payments: (params) => api.get(`/teacher/payments${qs(params)}`),
  approvePayment: (id) => api.post(`/teacher/payments/${id}/approve`),
  register: (eventId) => api.get(`/teacher/events/${eventId}/register`),
  markRegister: (eventId, marks) =>
    api.post(`/teacher/events/${eventId}/register`, { marks }),
  quizzes: () => api.get("/teacher/quizzes"),
  /* Authoring. readQuiz carries the answer key and the student version
     does not, which is why they are separate endpoints rather than one
     response filtered in the UI. */
  createQuiz: (body) => api.post("/teacher/quizzes", body),
  readQuiz: (id) => api.get(`/teacher/quizzes/${id}`),
  updateQuiz: (id, body) => api.put(`/teacher/quizzes/${id}`, body),
  quizResults: (id) => api.get(`/teacher/quizzes/${id}/results`),
  /* Marking. Written answers wait for a person, and any mark can be
     changed by hand, including one the server awarded. */
  markingQueue: () => api.get("/teacher/marking"),
  readAttempt: (id) => api.get(`/teacher/attempts/${id}`),
  setMarks: (id, marks) => api.post(`/teacher/attempts/${id}/marks`, { marks }),
  events: () => api.get("/teacher/events"),
  createEvent: (body) => api.post("/teacher/events", body),
  subjects: () => api.get("/teacher/subjects"),
};

export const ticketApi = {
  /* Read only. Rendering a ticket must never mint one. */
  current: (studentId) => api.get(`/tickets/current/${studentId}`),
  issue: (studentId) => api.post(`/tickets/issue/${studentId}`),
  scan: (payload) => api.post("/tickets/scan", { payload }),
};

export const studentApi = {
  overview: () => api.get("/student/overview"),
  library: (params) => api.get(`/student/library${qs(params)}`),
  quizzes: () => api.get("/student/quizzes"),
  /* Starting is a POST because it opens an attempt. Resuming an
     unfinished one is the same call, which is why it is not a GET. */
  startQuiz: (quizId) => api.post(`/student/quizzes/${quizId}/start`),
  submitQuiz: (quizId, answers) =>
    api.post(`/student/quizzes/${quizId}/submit`, { answers }),
  recordView: (contentId, body) =>
    api.post(`/student/content/${contentId}/view`, body),
  progress: () => api.get("/student/progress"),
  payments: () => api.get("/student/payments"),
  ticket: () => api.get("/student/ticket"),
};

export const parentApi = {
  progress: () => api.get("/parent/progress"),
  attendance: () => api.get("/parent/attendance"),
};

export const adminApi = {
  overview: () => api.get("/admin/overview"),
  people: (params) => api.get(`/admin/people${qs(params)}`),
  changeRole: (id, role) => api.patch(`/admin/people/${id}/role`, { role }),
  branding: () => api.get("/admin/branding"),
  updateBranding: (body) => api.patch("/admin/branding", body),
  removeLogo: () => api.del("/admin/branding/logo"),
  audit: (params) => api.get(`/admin/audit${qs(params)}`),
};

export const platformApi = {
  summary: () => api.get("/platform/summary"),
  tenants: (params) => api.get(`/platform/tenants${qs(params)}`),
  changeTier: (orgId, body) => api.patch(`/platform/tenants/${orgId}/tier`, body),
  audit: (params) => api.get(`/platform/audit${qs(params)}`),
  /* Cross tenant branding, for support. Guarded by
     require_platform_access on the server, not by the role alone. */
  readBranding: (orgId) => api.get(`/platform/branding/${orgId}`),
  updateBranding: (orgId, body) => api.patch(`/platform/branding/${orgId}`, body),
  removeLogo: () => api.del("/platform/branding/logo"),
};

export const accessApi = {
  catalogue: () => api.get("/access/catalogue"),
  organisation: () => api.get("/access/organisation"),
  updateOrganisation: (changes) => api.patch("/access/organisation", { changes }),
  resetOrganisation: () => api.post("/access/organisation/reset"),
  platform: (orgId) => api.get(`/access/platform${qs({ org_id: orgId })}`),
  updatePlatform: (changes, orgId) =>
    api.patch(`/access/platform${qs({ org_id: orgId })}`, { changes }),
  resetPlatform: (orgId) => api.post(`/access/platform/reset${qs({ org_id: orgId })}`),
};

/* Organisations offered on the login screen. Public by design: the
   slug is not a secret, and the picker needs it before anyone is
   authenticated. Falls back to a static list if the API is down so the
   login screen still renders. */
/* Which organisation this hostname belongs to.

   In production a tenant reaches ClassConnect at its own address, so the
   sign in page shows that one school and no picker. A parent at Horizon
   should not have to find their school in a list of strangers, and
   publishing that list hands anyone who loads the page a full customer
   roster.

   Unbound on localhost, which is what keeps the picker and the demo
   shortcuts working in development.

   Failing open to unbound is deliberate: if this call fails, the login
   screen falls back to the picker rather than showing nothing at all. */
export async function tenantForHost() {
  try {
    return await api.get("/auth/tenant");
  } catch {
    return { bound: false, isPlatform: false, organisation: null };
  }
}

export async function publicOrgs() {
  try {
    return await api.get("/auth/organisations");
  } catch {
    return [
      { slug: "horizon", name: "Horizon Tutoring", primaryColor: "#2f6f6b" },
      { slug: "northfield", name: "Northfield College", primaryColor: "#1f4f8f" },
      { slug: "brightpath", name: "Brightpath Academy", primaryColor: null },
      { slug: "looplab", name: "LoopLab (platform)", primaryColor: "#613380" },
    ];
  }
}
