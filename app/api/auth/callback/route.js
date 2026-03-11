export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const shop = searchParams.get("shop");

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  const rawText = await response.text();

  return new Response(`
    <h2>Shopify Response (status ${response.status}):</h2>
    <pre style="background:#f0f0f0; padding:16px; word-break:break-all;">${rawText}</pre>
  `, { headers: { "Content-Type": "text/html" } });
}