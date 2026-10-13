// Viewer request for the web shell. Built files are served as they are: any
// path under /assets/, and any path ending in a known static file extension.
// Every other path is a client-side route (/status, /membership, even a route
// whose last segment contains a dot such as /engagements/acme.co) and is served
// index.html.
var STATIC = /\.(html|js|mjs|css|map|json|webmanifest|txt|svg|png|jpg|jpeg|gif|webp|avif|ico|woff|woff2|ttf|otf)$/i;

function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.indexOf('/assets/') !== 0 && !STATIC.test(uri)) {
    request.uri = '/index.html';
  }
  return request;
}
