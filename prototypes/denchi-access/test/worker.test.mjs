
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import worker from "../src/worker.mjs";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const ORIGIN = "https://seminar.example.test";
const passcode = "dummy-passphrase-for-tests-only-2026";
function env() {
  return {
    SEMINAR_PASSCODE: passcode,
    SESSION_SIGNING_KEY: "nonproduction-signing-key-for-testing-only-0123456789",
    LOGIN_LIMITER: { limit: async () => ({ success: true }) },
    PRIVATE_MATERIALS: { get: async key => key === "seminar/2026-11-08/theme-01.pdf" ? { body: new Blob(["%PDF-1.4 fake test document"]).stream() } : null }
  };
}
function request(path, method = "GET", options = {}) {
  return new Request(ORIGIN + path, { method, ...options });
}
function post(code, options = {}) {
  return request("/login", "POST", {
    headers: { Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "192.0.2.10", ...(options.headers || {}) },
    body: "passcode=" + encodeURIComponent(code)
  });
}
async function loginCookie(e = env()) {
  const response = await worker.fetch(post(passcode), e);
  assert.equal(response.status, 303);
  return response.headers.get("Set-Cookie").split(";")[0];
}
test("no secrets or bindings: fail closed", async () => {
  const response = await worker.fetch(request("/"), {});
  assert.equal(response.status, 503);
});
test("login page is accessible, protected PDF is not", async () => {
  const e = env();
  assert.equal((await worker.fetch(request("/"), e)).status, 200);
  const response = await worker.fetch(request("/material"), e);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Cache-Control"), "no-store, private");
});
test("bad passphrase fails", async () => {
  const response = await worker.fetch(post("wrong-passphrase"), env());
  assert.equal(response.status, 401);
});
test("origin mismatch fails", async () => {
  const response = await worker.fetch(post(passcode, { headers: { Origin: "https://evil.example" } }), env());
  assert.equal(response.status, 403);
});
test("correct passphrase yields protected short-lived session cookie", async () => {
  const e = env();
  const login = await worker.fetch(post(passcode), e);
  assert.equal(login.status, 303);
  const setCookie = login.headers.get("Set-Cookie");
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  const cookie = setCookie.split(";")[0];
  const protectedResponse = await worker.fetch(request("/material", "GET", { headers: { Cookie: cookie } }), e);
  assert.equal(protectedResponse.status, 200);
  assert.equal(protectedResponse.headers.get("Content-Type"), "application/pdf");
  assert.equal(protectedResponse.headers.get("Cache-Control"), "no-store, private");
  assert.equal(protectedResponse.headers.get("Vary"), "Cookie");
  assert.equal(protectedResponse.headers.get("Access-Control-Allow-Origin"), null);
  assert.match(await protectedResponse.text(), /fake test document/);
});
test("expired session is rejected", async () => {
  const realNow = Date.now;
  try {
    const start = 1_800_000_000_000;
    Date.now = () => start;
    const e = env();
    const cookie = await loginCookie(e);
    Date.now = () => start + 7_201_000;
    const response = await worker.fetch(request("/material", "GET", { headers: { Cookie: cookie } }), e);
    assert.equal(response.status, 403);
  } finally {
    Date.now = realNow;
  }
});
test("tampered session signature rejected", async () => {
  const e = env();
  const login = await worker.fetch(post(passcode), e);
  const cookie = login.headers.get("Set-Cookie").split(";")[0];
  const altered = cookie.slice(0, -1) + (cookie.endsWith("0") ? "1" : "0");
  const response = await worker.fetch(request("/material", "GET", { headers: { Cookie: altered } }), e);
  assert.equal(response.status, 403);
});
test("unavailable PDF cannot be fetched", async () => {
  const e = env();
  e.PRIVATE_MATERIALS.get = async () => null;
  const login = await worker.fetch(post(passcode), e);
  const cookie = login.headers.get("Set-Cookie").split(";")[0];
  assert.equal((await worker.fetch(request("/material", "GET", { headers: { Cookie: cookie } }), e)).status, 404);
});
test("rate limiter denies repeated attempts", async () => {
  const e = env(); e.LOGIN_LIMITER.limit = async () => ({ success: false });
  const response = await worker.fetch(post(passcode), e);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
});
test("brute-force attempts are stopped after the configured threshold", async () => {
  const e = env();
  let attempts = 0;
  e.LOGIN_LIMITER.limit = async ({ key }) => {
    assert.equal(key, "192.0.2.10");
    attempts += 1;
    return { success: attempts <= 5 };
  };
  for (let i = 0; i < 5; i += 1) assert.equal((await worker.fetch(post("wrong-" + i), e)).status, 401);
  assert.equal((await worker.fetch(post(passcode), e)).status, 429);
});
test("rate limiter failure fails closed without exposing details", async () => {
  const e = env(); e.LOGIN_LIMITER.limit = async () => { throw new Error("internal limiter detail"); };
  const response = await worker.fetch(post(passcode), e);
  assert.equal(response.status, 503);
  assert.equal(await response.text(), "Service unavailable");
});
test("oversized, malformed-length, and invalid UTF-8 login bodies are rejected", async () => {
  const e = env();
  const baseHeaders = { Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "192.0.2.10" };
  assert.equal((await worker.fetch(request("/login", "POST", { headers: { ...baseHeaders, "Content-Length": "1025" }, body: "passcode=x" }), e)).status, 403);
  assert.equal((await worker.fetch(request("/login", "POST", { headers: { ...baseHeaders, "Content-Length": "not-a-number" }, body: "passcode=x" }), e)).status, 403);
  assert.equal((await worker.fetch(request("/login", "POST", { headers: baseHeaders, body: new Uint8Array(1025) }), e)).status, 403);
  assert.equal((await worker.fetch(request("/login", "POST", { headers: baseHeaders, body: new Uint8Array([0xff]) }), e)).status, 403);
});
test("login errors do not reflect attacker-controlled markup", async () => {
  const marker = "<img src=x onerror=alert(1)>";
  const response = await worker.fetch(post(marker), env());
  assert.equal(response.status, 401);
  assert.doesNotMatch(await response.text(), /<img src=x/);
  assert.match(response.headers.get("Content-Security-Policy"), /default-src 'none'/);
});
test("R2 failures fail closed without exposing storage errors", async () => {
  const e = env();
  e.PRIVATE_MATERIALS.get = async () => { throw new Error("private bucket detail"); };
  const cookie = await loginCookie(e);
  const response = await worker.fetch(request("/material", "GET", { headers: { Cookie: cookie } }), e);
  assert.equal(response.status, 503);
  assert.equal(await response.text(), "Service unavailable");
});
test("URL arguments and traversal paths cannot address a different object", async () => {
  const e = env();
  assert.equal((await worker.fetch(request("/material?file=other.pdf"), e)).status, 404);
  assert.equal((await worker.fetch(request("/private-file.pdf"), e)).status, 404);
});
test("POST logout requires matching Origin", async () => {
  const e = env();
  assert.equal((await worker.fetch(request("/logout", "POST"), e)).status, 403);
  const res = await worker.fetch(request("/logout", "POST", { headers: { Origin: ORIGIN } }), e);
  assert.equal(res.status, 303);
  assert.match(res.headers.get("Set-Cookie"), /Max-Age=0/);
});
