const { EventEmitter } = require('events');

function createMockNodeRequest(method, urlString, bodyBuffer, headers = {}, extras = {}) {
  const request = new EventEmitter();
  Object.assign(request, { method, url: urlString, headers, complete: false, aborted: false });
  if (extras.signal) request.signal = extras.signal;
  process.nextTick(() => {
    if (bodyBuffer && bodyBuffer.length > 0) request.emit('data', bodyBuffer);
    request.complete = true;
    request.emit('end');
  });
  if (extras.signal) {
    const abort = () => {
      request.aborted = true;
      request.emit('aborted');
      request.emit('close');
    };
    if (extras.signal.aborted) process.nextTick(abort);
    else extras.signal.addEventListener('abort', abort, { once: true });
  }
  return request;
}

function createMockNodeResponse() {
  let statusCode = 200;
  let headers = {};
  let controller = null;
  let started = false;
  let finished = false;
  const pending = [];
  let headersResolve;
  const headersSentPromise = new Promise((resolve) => { headersResolve = resolve; });

  const stream = new ReadableStream({
    start(c) {
      controller = c;
      pending.forEach((chunk) => c.enqueue(chunk));
      pending.length = 0;
      if (finished) c.close();
    }
  });

  function enqueue(data) {
    const buf = data == null ? Buffer.alloc(0) : (Buffer.isBuffer(data) ? data : Buffer.from(String(data)));
    if (!buf.length) return;
    if (controller) controller.enqueue(buf);
    else pending.push(buf);
  }

  const response = {
    writeHead(code, nextHeaders) {
      statusCode = code;
      if (nextHeaders) headers = { ...nextHeaders };
      started = true;
      headersResolve();
    },
    write(data) {
      if (!started) this.writeHead(statusCode, headers);
      enqueue(data);
      return true;
    },
    end(data) {
      if (!started) this.writeHead(statusCode, headers);
      if (data !== undefined) enqueue(data);
      finished = true;
      if (controller) {
        try { controller.close(); } catch (_) { /* already closed */ }
      }
      headersResolve();
    },
    get headersSent() { return started; },
    get writableEnded() { return finished; }
  };

  return {
    response,
    getStatusCode: () => statusCode,
    getHeaders: () => headers,
    getBody: () => stream,
    isFinished: () => finished,
    whenHeadersSent: () => headersSentPromise
  };
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
