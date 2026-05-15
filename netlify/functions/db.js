exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method Not Allowed" }) };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Supabase nicht konfiguriert" }) };
  }

  try {
    const { action, table, data, filter, jwt } = JSON.parse(event.body);

    let url = `${SUPABASE_URL}/rest/v1/${table}`;
    let method = "GET";
    let body = null;
    const params = new URLSearchParams();

    if (filter) Object.entries(filter).forEach(([k, v]) => params.append(k, `eq.${v}`));

    if (action === "select") {
      if (filter) url += `?${params}`;
      if (data?.order) url += (url.includes("?") ? "&" : "?") + `order=${data.order}`;
      if (data?.limit) url += (url.includes("?") ? "&" : "?") + `limit=${data.limit}`;
    } else if (action === "insert") {
      method = "POST"; body = JSON.stringify(data);
    } else if (action === "update") {
      method = "PATCH"; url += `?${params}`; body = JSON.stringify(data);
    } else if (action === "delete") {
      method = "DELETE"; url += `?${params}`;
    }

    const resp = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_KEY,
        "Authorization": jwt ? `Bearer ${jwt}` : `Bearer ${SUPABASE_KEY}`,
        "Prefer": action === "insert" || action === "update" ? "return=representation" : "",
      },
      body,
    });

    const result = await resp.json();
    return { statusCode: resp.status, headers, body: JSON.stringify(result) };

  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
