function createController({ readerWriterTransferService, readJsonPayload, jsonResponse } = {}) {
  if (!readerWriterTransferService) throw new Error('readerWriterTransferService is required');
  return async function handle(request, response, appRoot, dataRoot, parsedUrl) {
    if (!parsedUrl.pathname.startsWith('/api/writer/reader-transfer/')) return false;
    try {
      if (request.method !== 'POST') {
        jsonResponse(response, 405, { ok: false, error: 'Method not allowed' });
        return true;
      }
      const payload = await readJsonPayload(request);
      if (parsedUrl.pathname === '/api/writer/reader-transfer/preview') {
        jsonResponse(response, 200, { ok: true, preview: await readerWriterTransferService.preview(dataRoot, payload) });
        return true;
      }
      if (parsedUrl.pathname === '/api/writer/reader-transfer/apply') {
        jsonResponse(response, 200, await readerWriterTransferService.apply(dataRoot, payload));
        return true;
      }
      jsonResponse(response, 404, { ok: false, error: 'Writer reader-transfer route not found' });
    } catch (error) {
      const status = /changed after preview|conflict/i.test(error.message || '') ? 409 : /not found|unavailable|no longer exists/i.test(error.message || '') ? 404 : 400;
      jsonResponse(response, status, { ok: false, error: error.message || String(error) });
    }
    return true;
  };
}

module.exports = { createController };
