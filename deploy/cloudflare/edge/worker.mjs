const BODYLESS_METHODS = new Set(['GET', 'HEAD']);

function rewriteRequestHeader(headers, name, publicOrigin, upstreamOrigin) {
  const value = headers.get(name);
  if (value?.startsWith(publicOrigin)) {
    headers.set(name, `${upstreamOrigin}${value.slice(publicOrigin.length)}`);
  }
}

export default {
  async fetch(request, env) {
    const publicUrl = new URL(request.url);
    const upstreamOrigin = new URL(env.UPSTREAM_ORIGIN).origin;
    const upstreamUrl = new URL(`${publicUrl.pathname}${publicUrl.search}`, upstreamOrigin);
    const headers = new Headers(request.headers);

    rewriteRequestHeader(headers, 'origin', publicUrl.origin, upstreamOrigin);
    rewriteRequestHeader(headers, 'referer', publicUrl.origin, upstreamOrigin);
    headers.set('x-forwarded-host', new URL(upstreamOrigin).host);
    headers.set('x-forwarded-proto', 'https');

    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: BODYLESS_METHODS.has(request.method) ? undefined : request.body,
      redirect: 'manual',
    });

    const responseHeaders = new Headers(upstream.headers);
    const location = responseHeaders.get('location');
    if (location?.startsWith(upstreamOrigin)) {
      responseHeaders.set('location', `${publicUrl.origin}${location.slice(upstreamOrigin.length)}`);
    }
    responseHeaders.set('x-intellifin-cloudflare-edge', 'active');

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  },
};
