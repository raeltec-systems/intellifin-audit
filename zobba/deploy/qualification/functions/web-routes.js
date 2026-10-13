// Viewer request for the web shell: a path whose last segment has no file
// extension is a client-side route (/status, /membership, ...) and is served
// index.html. Files such as /assets/app-1234.js are served as they are.
function handler(event) {
  var request = event.request;
  var last = request.uri.split('/').pop();
  if (last.indexOf('.') === -1) {
    request.uri = '/index.html';
  }
  return request;
}
