// Viewer request for /api/*: remove the /api prefix exactly as the development
// proxy does (zobba/web/vite.config.ts: /^\/api(?=\/)/), so /api/auth/callback
// reaches the API as /auth/callback. The query string is left untouched.
function handler(event) {
  var request = event.request;
  if (request.uri.indexOf('/api/') === 0) {
    request.uri = request.uri.substring(4);
  }
  return request;
}
