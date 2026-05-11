import { corsHeaders, handleCors } from '../_shared/cors.ts';

const SOCIALLY_BASE = 'https://socially.ng/api/v1';

Deno.serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    const token = Deno.env.get('SOCIALLY_API_TOKEN');
    if (!token) throw new Error('Socially API token not configured');

    const { path, method, body } = await req.json();

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    };

    const httpMethod = method || 'GET';
    let fetchOptions: RequestInit = { method: httpMethod, headers };

    if (body && (httpMethod === 'POST' || httpMethod === 'PUT')) {
      const form = new FormData();
      for (const [key, value] of Object.entries(body)) {
        form.append(key, String(value));
      }
      fetchOptions.body = form;
    }

    // For GET requests with a body, append as query params
    if (body && httpMethod === 'GET') {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(body)) {
        params.append(key, String(value));
      }
      // params unused for path-based GET endpoints like OTP
    }

    const url = path.startsWith('http') ? path : `${SOCIALLY_BASE}${path}`;
    console.log(`Socially proxy: ${method || 'GET'} ${url}`);

    const res = await fetch(url, fetchOptions);
    const data = await res.json();

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: res.status,
    });
  } catch (err) {
    console.error('Socially proxy error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
