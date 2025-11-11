const fetch = require('node-fetch');

if (typeof global.fetch !== 'function') {
  global.fetch = fetch;
}
if (typeof global.Headers !== 'function') {
  global.Headers = fetch.Headers;
}
if (typeof global.Request !== 'function') {
  global.Request = fetch.Request;
}
if (typeof global.Response !== 'function') {
  global.Response = fetch.Response;
}
