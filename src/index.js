export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.json({
        status: "online",
        aplikasi: "Siaga Banjir API",
        platform: "Cloudflare Workers"
      });
    }

    return Response.json({
      error: "Endpoint tidak ditemukan"
    }, { status: 404 });
  }
};
