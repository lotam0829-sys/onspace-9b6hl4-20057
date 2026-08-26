// vibe-socially-sms-mcp
// MCP server wrapping Socially.ng's SMS Verification API (Bearer Token auth).
// Goal of this connector: buy a temporary number and retrieve the OTP sent to
// it — NOT the SMM/social-boost side (that's vibe-socially-mcp, key+action auth).
//
// Endpoint paths/params below are taken from this app's own working
// integration (supabase/functions/socially-proxy, purchase-number, sms-webhook
// and services/sociallyService.ts), not just the API reference doc, since the
// reference doc's paths don't all match what the live API actually accepts —
// notably the OTP lookup, which is a path param called `reference`, not a
// query param called `order_id`.

const PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_API_BASE = "https://socially.ng/api/v1";

const TOOLS = [
  {
    name: "get_sms_providers",
    description: "List available SMS verification providers from Socially.ng",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_provider_countries",
    description: "List countries/services supported by a specific SMS verification provider",
    inputSchema: {
      type: "object",
      properties: {
        provider_code: { type: "string", description: "Provider code returned by get_sms_providers" },
      },
      required: ["provider_code"],
    },
  },
  {
    name: "get_service_packages",
    description: "Get pricing/packages for a specific service (e.g. Telegram, TikTok, WhatsApp) in a given country, for a given provider",
    inputSchema: {
      type: "object",
      properties: {
        provider_code: { type: "string", description: "Provider code" },
        country_code: { type: "string", description: "Country/service code returned by get_provider_countries" },
      },
      required: ["provider_code", "country_code"],
    },
  },
  {
    name: "buy_sms_number",
    description: "Purchase a temporary phone number for SMS/OTP verification for a specific provider/country/project. Returns the mobile number plus a `reference` — pass that reference to get_sms_otp to retrieve the code.",
    inputSchema: {
      type: "object",
      properties: {
        provider_code: { type: "string", description: "Provider code" },
        country_code: { type: "string", description: "Country/service code" },
        project_code: { type: "string", description: "Project code returned by get_service_packages" },
        reference: { type: "string", description: "Optional client-generated order reference. Auto-generated if omitted." },
      },
      required: ["provider_code", "country_code", "project_code"],
    },
  },
  {
    name: "get_sms_otp",
    description: "Retrieve the OTP code sent to a purchased number, keyed by the `reference` returned from buy_sms_number.",
    inputSchema: {
      type: "object",
      properties: {
        reference: { type: "string", description: "The reference returned by buy_sms_number" },
      },
      required: ["reference"],
    },
  },
  {
    name: "get_balance",
    description: "Check the Socially.ng account balance used to fund number purchases.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method === "GET") {
      return Response.json(
        {
          name: "Socially.ng SMS Verification MCP",
          version: "1.0.0",
          description: "Temporary phone number / OTP verification via Socially.ng, for NumVault",
          protocolVersion: PROTOCOL_VERSION,
          tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
        },
        { headers: corsHeaders }
      );
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return mcpError(null, -32700, "Parse error");
    }

    const { id, method, params } = body;

    switch (method) {
      case "initialize":
        return mcpOk(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "Socially.ng SMS Verification MCP", version: "1.0.0" },
        });

      case "notifications/initialized":
        return new Response(null, { status: 204, headers: corsHeaders });

      case "ping":
        return mcpOk(id, {});

      case "tools/list":
        return mcpOk(id, { tools: TOOLS });

      case "tools/call": {
        const toolName = params?.name;
        const args = params?.arguments ?? {};
        try {
          let result;
          switch (toolName) {
            case "get_sms_providers":
              result = await getProviders(env);
              break;
            case "get_provider_countries":
              result = await getProviderCountries(env, args);
              break;
            case "get_service_packages":
              result = await getServicePackages(env, args);
              break;
            case "buy_sms_number":
              result = await buySmsNumber(env, args);
              break;
            case "get_sms_otp":
              result = await getSmsOtp(env, args);
              break;
            case "get_balance":
              result = await getBalance(env);
              break;
            default:
              return mcpError(id, -32601, `Unknown tool: ${toolName}`);
          }
          return mcpOk(id, {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          });
        } catch (err) {
          return mcpError(id, -32603, String(err));
        }
      }

      default:
        return mcpError(id, -32601, `Method not found: ${method}`);
    }
  },
};

// --- Shared request helper -------------------------------------------------

async function sociallyRequest(env, path, { method = "GET", query, body } = {}) {
  const token = env.NUMVAULT_TOKEN;
  if (!token) {
    throw new Error("Missing NUMVAULT_TOKEN secret in Worker environment");
  }
  const apiBase = env.NUMVAULT_BASE_URL || DEFAULT_API_BASE;

  let url = `${apiBase}${path}`;
  if (query) {
    const qs = new URLSearchParams(query).toString();
    if (qs) url += `?${qs}`;
  }

  const init = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  };

  if (body) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url, init);
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`Socially.ng API error: ${response.status} ${response.statusText} — ${JSON.stringify(data)}`);
  }

  return data;
}

// --- Tool implementations ---------------------------------------------------

async function getProviders(env) {
  const data = await sociallyRequest(env, "/sms/verification/providers");
  return { success: true, providers: data?.data ?? data };
}

async function getProviderCountries(env, args) {
  const { provider_code } = args;
  if (!provider_code) throw new Error("Missing required parameter: provider_code");
  const data = await sociallyRequest(env, `/sms/verification/provider/${provider_code}/countries`);
  return { success: true, provider_code, countries: data?.data ?? data };
}

async function getServicePackages(env, args) {
  const { provider_code, country_code } = args;
  if (!provider_code || !country_code) {
    throw new Error("Missing required parameters: provider_code, country_code");
  }
  const data = await sociallyRequest(env, "/sms/verification/service/provider/packages", {
    method: "POST",
    body: { provider_code, country_code },
  });
  return { success: true, provider_code, country_code, packages: data?.data ?? data };
}

async function buySmsNumber(env, args) {
  const { provider_code, country_code, project_code, reference } = args;
  if (!provider_code || !country_code || !project_code) {
    throw new Error("Missing required parameters: provider_code, country_code, project_code");
  }
  const orderReference = reference || `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const data = await sociallyRequest(env, "/buy/sms/verification/number", {
    method: "POST",
    body: { provider_code, country_code, project_code, reference: orderReference },
  });

  const numberData = data?.data ?? data;
  return {
    success: true,
    provider_code,
    country_code,
    project_code,
    reference: orderReference,
    mobile_number: numberData?.mobile_number ?? null,
    order: numberData,
    purchased_at: new Date().toISOString(),
    message: "Number purchased — use get_sms_otp with this reference to retrieve the code.",
  };
}

async function getSmsOtp(env, args) {
  const { reference } = args;
  if (!reference) throw new Error("Missing required parameter: reference");

  const data = await sociallyRequest(env, `/request/sms/verification/${reference}/otp`);

  const message = data?.message ?? "";
  const otpMatch = String(message).match(/\((\d{4,8})\)/);
  const otp = otpMatch ? otpMatch[1] : null;
  const mobileNumber = data?.data?.mobile_number ?? null;

  return {
    success: true,
    reference,
    otp,
    mobile_number: mobileNumber,
    ready: Boolean(otp),
    raw: data,
  };
}

async function getBalance(env) {
  const token = env.NUMVAULT_TOKEN;
  if (!token) {
    throw new Error("Missing NUMVAULT_TOKEN secret in Worker environment");
  }
  const apiBase = env.NUMVAULT_BASE_URL || DEFAULT_API_BASE;

  // Balance is not a Bearer-auth path like the other tools — Socially.ng
  // exposes it only via the SMM-style unified endpoint: POST to the base
  // URL with form fields key + action=balance. The same account token
  // works here as `key`.
  const form = new URLSearchParams();
  form.append("key", token);
  form.append("action", "balance");

  const response = await fetch(apiBase, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`Socially.ng API error: ${response.status} ${response.statusText} — ${JSON.stringify(data)}`);
  }

  return {
    success: true,
    balance: data?.balance ?? null,
    currency: data?.currency ?? null,
    raw: data,
  };
}

// --- MCP response helpers ---------------------------------------------------

function mcpOk(id, result) {
  return Response.json({ jsonrpc: "2.0", id, result }, { headers: corsHeaders });
}

function mcpError(id, code, message) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status: 400, headers: corsHeaders });
}
