// Send one admin action to the alarm-gas endpoint with the Google ID
// token. The body is JSON sent as text/plain, the same transport the
// tweet site uses (it avoids a CORS preflight against Apps Script).
// Returns the parsed JSON response ({ ok: true, ... } or
// { ok: false, error }). Throws on network/parse failure.
export async function callApi(endpoint, idToken, body, fetchImpl = fetch) {
  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ idToken, ...body }),
  });
  return res.json();
}
