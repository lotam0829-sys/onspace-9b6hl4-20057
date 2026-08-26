# vibe-socially-sms-mcp

Cloudflare Worker MCP connector for Socially.ng's **SMS Verification** API
(temporary numbers for receiving OTPs). This is the OTP side, separate from
`vibe-socially-mcp` (the SMM/social-boost connector, which uses `key`+`action`
form params instead of Bearer auth).

## Tools

| Tool | Socially.ng endpoint |
| :--- | :--- |
| `get_sms_providers` | `GET /sms/verification/providers` |
| `get_provider_countries` | `GET /sms/verification/provider/{provider_code}/countries` |
| `get_service_packages` | `POST /sms/verification/service/provider/packages` |
| `buy_sms_number` | `POST /buy/sms/verification/number` |
| `get_sms_otp` | `GET /request/sms/verification/{reference}/otp` |
| `get_balance` | `POST` to the base URL (not a sub-path) with form fields `key=<NUMVAULT_TOKEN>&action=balance` — the SMM-style unified endpoint, since Socially.ng has no separate Bearer-auth balance route |

Typical flow: `get_sms_providers` → `get_provider_countries` →
`get_service_packages` → `buy_sms_number` (returns a `mobile_number` and a
`reference`) → poll `get_sms_otp` with that `reference` until `otp` is
non-null.

## Deploy

```bash
cd workers/vibe-socially-sms-mcp
wrangler secret put NUMVAULT_TOKEN
# optional — only needed if the base URL ever changes:
wrangler secret put NUMVAULT_BASE_URL
wrangler deploy
```

Then register the deployed URL as an MCP connector.
