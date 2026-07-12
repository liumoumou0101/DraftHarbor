const { EventEmitter } = require('events');

function createMockNodeRequest(method, urlString, bodyBuffer, headers = {}) {
  const request = new EventEmitter();
  Object.assign(request, { method, url: urlString, headers });
  process.nextTick(() => {
    if (bodyBuffer && bodyBuffer.length > 0) request.emit('data', bodyBuffer);
    request.emit('end');
  });
  return request;
}

function createMockNodeResponse() {
  let statusCode = 200;
  let headers = {};
  let body = null;
  let finished = false;
  const response = {
    writeHead(code, nextHeaders) { statusCode = code; if (nextHeaders) headers = { ...nextHeaders }; finished = true; },
    end(data) { if (data !== undefined) body = Buffer.isBuffer(data) ? data : Buffer.from(String(data)); finished = true; },
    get headersSent() { return finished; }
  };
  return { response, getStatusCode: () => statusCode, getHeaders: () => headers, getBody: () => body, isFinished: () => finished };
}

function mockResponseToFetchResponse(mockResponse) {
  const headers = Object.fromEntries(Object.entries(mockResponse.getHeaders())
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)]));
  return new Response(mockResponse.getBody(), { status: mockResponse.getStatusCode(), headers });
}

async function readFetchBodyStream(stream) {
  if (!stream) return Buffer.alloc(0);
  try {
    const reader = stream.getReader();
    const chunks = [];
    while (true) { const { done, value } = await reader.read(); if (done) break; chunks.push(Buffer.from(value)); }
    return Buffer.concat(chunks);
  } catch { return Buffer.alloc(0); }
}

function fetchHeadersToPlain(fetchRequest) {
  return fetchRequest.headers ? Object.fromEntries([...fetchRequest.headers].map(([key, value]) => [key.toLowerCase(), value])) : {};
}

module.exports = { createMockNodeRequest, createMockNodeResponse, mockResponseToFetchResponse, readFetchBodyStream, fetchHeadersToPlain };
