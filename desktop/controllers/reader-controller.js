function cleanString(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

async function decorateLibraryDocuments(dataRoot, documents, dependencies) {
  const { readerStore, readerStateStore, readerProjectLibraryService } = dependencies;
  return Promise.all((Array.isArray(documents) ? documents : []).map(async (document) => {
    try {
      const metadata = document.sourceKind === 'project' && readerProjectLibraryService
        ? await readerProjectLibraryService.readMetadata(dataRoot, document.documentId.slice('project:'.length))
        : await readerStore.readReaderDocumentMetadata(dataRoot, document.documentId);
      const revision = metadata && metadata.revisions && metadata.revisions.find((item) => item.revisionId === metadata.activeRevisionId)
        || metadata && metadata.revisions && metadata.revisions[metadata.revisions.length - 1];
      const state = await readerStateStore.readReaderDocumentState(dataRoot, document.documentId);
      const chapterCount = Number(revision && revision.chapterCount) || Number(document.chapterCount) || 0;
      const characterCount = Number(revision && revision.characterCount) || Number(document.characterCount) || 0;
      const chapterIndex = state && state.positionLocator && revision && Array.isArray(revision.chapters)
        ? revision.chapters.findIndex((chapter) => chapter.chapterId === state.positionLocator.chapterId)
        : -1;
      const progress = state && state.positionLocator && chapterCount > 0
        ? Math.max(1, Math.min(99, Math.round(((Math.max(0, chapterIndex) + 0.5) / chapterCount) * 100)))
        : 0;
      return {
        ...document,
        chapterCount,
        characterCount,
        revisionCount: Number(metadata && metadata.revisions && metadata.revisions.length) || Number(document.revisionCount) || 1,
        health: 'ready',
        reading: {
          hasState: !!state,
          lastReadAt: state && state.updatedAt || '',
          chapterId: state && state.positionLocator && state.positionLocator.chapterId || '',
          progress
        }
      };
    } catch (error) {
      return {
        ...document,
        health: 'degraded',
        healthMessage: '书籍摘要暂不可用',
        reading: { hasState: false, lastReadAt: '', chapterId: '', progress: 0 }
      };
    }
  }));
}

function createController(dependencies) {
  const {
    readerStore,
    readerStateStore,
    readerAnnotationStore,
    readerLibraryViewStore,
    readerAppearanceStore,
    readerFontStore,
    readerLibraryService,
    readerProjectLibraryService,
    readerMigrationService,
    readerTransferService,
    readJsonPayload,
    jsonResponse
  } = dependencies;

  function errorStatus(error) {
    if (error && /ConflictError$/.test(error.name || '')) return 409;
    if (error && /not found/i.test(error.message || '')) return 404;
    return 400;
  }

  async function respond(response, task) {
    try {
      jsonResponse(response, 200, await task());
    } catch (error) {
      jsonResponse(response, errorStatus(error), { ok: false, error: error.message || String(error) });
    }
    return true;
  }

  return async function handle(request, response, appRoot, dataRoot, parsedUrl) {
    const { pathname } = parsedUrl;
    if (!pathname.startsWith('/api/reader/')) return false;

    if (request.method === 'GET' && pathname === '/api/reader/documents') {
      return respond(response, async () => {
        const library = await readerStore.listReaderDocuments(dataRoot);
        const projects = readerProjectLibraryService
          ? await readerProjectLibraryService.listDocuments(dataRoot)
          : [];
        const documents = await decorateLibraryDocuments(dataRoot, [...library.documents, ...projects], {
          readerStore,
          readerStateStore,
          readerProjectLibraryService
        });
        return { ok: true, index: library.index, documents };
      });
    }

    if (request.method === 'GET' && pathname === '/api/reader/library-view') {
      return respond(response, async () => ({
        ok: true,
        record: await readerLibraryViewStore.readReaderLibraryView(dataRoot)
      }));
    }

    if (request.method === 'POST' && pathname === '/api/reader/library-view') {
      return respond(response, async () => {
        const payload = await readJsonPayload(request);
        const record = await readerLibraryViewStore.writeReaderLibraryView(
          dataRoot,
          payload.view || payload,
          { expectedUpdatedAt: payload.expectedUpdatedAt, updatedAt: payload.updatedAt }
        );
        return { ok: true, record };
      });
    }

    if (request.method === 'GET' && pathname === '/api/reader/document') {
      return respond(response, async () => {
        const documentId = cleanString(parsedUrl.searchParams.get('documentId'));
        if (!documentId) throw new Error('reader documentId is required');
        if (documentId.startsWith('project:') && readerProjectLibraryService) {
          const metadata = await readerProjectLibraryService.readMetadata(dataRoot, documentId.slice('project:'.length));
          return { ok: true, metadata };
        }
        const metadata = await readerStore.readReaderDocumentMetadata(dataRoot, documentId);
        if (!metadata) throw new Error('reader document not found');
        return { ok: true, metadata };
      });
    }

    if (request.method === 'GET' && pathname === '/api/reader/chapter') {
      return respond(response, async () => {
        const documentId = cleanString(parsedUrl.searchParams.get('documentId'));
        const chapterId = cleanString(parsedUrl.searchParams.get('chapterId'));
        if (!documentId || !chapterId) throw new Error('reader documentId and chapterId are required');
        if (documentId.startsWith('project:') && readerProjectLibraryService) {
          const result = await readerProjectLibraryService.readChapter(
            dataRoot,
            documentId.slice('project:'.length),
            parsedUrl.searchParams.get('revisionId'),
            chapterId
          );
          if (!result) throw new Error('reader chapter not found');
          return { ok: true, documentId, revision: result.revision, chapter: result.chapter };
        }
        const metadata = await readerStore.readReaderDocumentMetadata(dataRoot, documentId);
        if (!metadata) throw new Error('reader document not found');
        const revisionId = cleanString(parsedUrl.searchParams.get('revisionId')) || metadata.activeRevisionId;
        const result = await readerStore.readReaderDocumentChapter(dataRoot, documentId, revisionId, chapterId);
        if (!result) throw new Error('reader chapter not found');
        return {
          ok: true,
          documentId,
          revision: result.revision,
          chapter: result.chapter
        };
      });
    }

    if (request.method === 'GET' && pathname === '/api/reader/contents') {
      return respond(response, async () => {
        const documentId = cleanString(parsedUrl.searchParams.get('documentId'));
        if (!documentId) throw new Error('reader documentId is required');
        if (documentId.startsWith('project:') && readerProjectLibraryService) {
          const contents = await readerProjectLibraryService.readContents(dataRoot, documentId.slice('project:'.length));
          return { ok: true, documentId, contents };
        }
        const documentMetadata = await readerStore.readReaderDocumentMetadata(dataRoot, documentId);
        if (!documentMetadata) throw new Error('reader document not found');
        const revisionId = cleanString(parsedUrl.searchParams.get('revisionId')) || documentMetadata.activeRevisionId;
        const contents = await readerStore.readReaderDocumentContents(dataRoot, documentId, revisionId);
        if (!contents) throw new Error('reader revision not found');
        return { ok: true, documentId, contents };
      });
    }

    if (request.method === 'GET' && pathname === '/api/reader/preferences') {
      return respond(response, async () => ({
        ok: true,
        record: await readerStateStore.readReaderGlobalPreferences(dataRoot)
      }));
    }

  if (request.method === 'POST' && pathname === '/api/reader/preferences') {
      return respond(response, async () => {
        const payload = await readJsonPayload(request);
        const record = await readerStateStore.writeReaderGlobalPreferences(
          dataRoot,
          payload.preferences || payload,
          { expectedUpdatedAt: payload.expectedUpdatedAt, updatedAt: payload.updatedAt }
        );
        return { ok: true, record };
      });
    }

    if (request.method === 'GET' && pathname === '/api/reader/state') {
      return respond(response, async () => {
        const documentId = cleanString(parsedUrl.searchParams.get('documentId'));
        if (!documentId) throw new Error('reader documentId is required');
        return { ok: true, state: await readerStateStore.readReaderDocumentState(dataRoot, documentId) };
      });
    }

    if (request.method === 'POST' && pathname === '/api/reader/state') {
      return respond(response, async () => {
        const payload = await readJsonPayload(request);
        const state = await readerStateStore.writeReaderDocumentState(
          dataRoot,
          payload.state || payload,
          { expectedUpdatedAt: payload.expectedUpdatedAt }
        );
        return { ok: true, state };
      });
    }

    if (request.method === 'GET' && pathname === '/api/reader/appearances') {
      return respond(response, async () => ({ ok: true, ...(await readerAppearanceStore.readReaderAppearances(dataRoot)) }));
    }

    if (request.method === 'POST' && pathname === '/api/reader/appearances') {
      return respond(response, async () => {
        const payload = await readJsonPayload(request);
        const result = await readerAppearanceStore.writeReaderAppearance(dataRoot, payload.profile || payload, {
          expectedUpdatedAt: payload.expectedUpdatedAt
        });
        return { ok: true, record: result.record, profile: result.profile };
      });
    }

    if (request.method === 'DELETE' && pathname === '/api/reader/appearances') {
      return respond(response, async () => {
        const profileId = cleanString(parsedUrl.searchParams.get('profileId'));
        const result = await readerAppearanceStore.deleteReaderAppearance(dataRoot, profileId, {
          expectedUpdatedAt: cleanString(parsedUrl.searchParams.get('expectedUpdatedAt')) || undefined
        });
        return { ok: true, record: result.record, profileId: result.profileId };
      });
    }

    if (request.method === 'GET' && pathname === '/api/reader/fonts') {
      return respond(response, async () => ({ ok: true, catalog: await readerFontStore.readReaderFontCatalog(dataRoot) }));
    }

    if (request.method === 'POST' && pathname === '/api/reader/fonts') {
      return respond(response, async () => {
        const payload = await readJsonPayload(request);
        const result = await readerFontStore.importReaderFont(dataRoot, {
          ...payload,
          bytes: payload.bytes
        });
        return { ok: true, catalog: result.catalog, entry: result.entry, idempotent: result.idempotent };
      });
    }

    if (request.method === 'DELETE' && pathname === '/api/reader/fonts') {
      return respond(response, async () => {
        const result = await readerFontStore.removeReaderFont(dataRoot, parsedUrl.searchParams.get('fontId'), {
          expectedCatalogVersion: parsedUrl.searchParams.get('expectedCatalogVersion') || undefined
        });
        return { ok: true, catalog: result.catalog, fontId: result.fontId };
      });
    }

    if (request.method === 'GET' && pathname === '/api/reader/fonts/file') {
      try {
        const result = await readerFontStore.readReaderFontFile(dataRoot, parsedUrl.searchParams.get('fontId'));
        const mimeType = result.entry.format === 'ttf'
          ? 'font/ttf'
          : result.entry.format === 'otf' ? 'font/otf' : 'font/woff2';
        response.writeHead(200, {
          'Content-Type': mimeType,
          'Content-Length': result.bytes.length,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff'
        });
        response.end(result.bytes);
      } catch (error) {
        jsonResponse(response, errorStatus(error), { ok: false, error: error.message || String(error) });
      }
      return true;
    }

    if (request.method === 'GET' && pathname === '/api/reader/annotations') {
      return respond(response, async () => {
        const documentId = cleanString(parsedUrl.searchParams.get('documentId'));
        if (!documentId) throw new Error('reader documentId is required');
        return { ok: true, record: await readerAnnotationStore.readReaderAnnotations(dataRoot, documentId) };
      });
    }

    if (request.method === 'POST' && pathname === '/api/reader/annotations') {
      return respond(response, async () => {
        const payload = await readJsonPayload(request);
        const record = await readerAnnotationStore.upsertReaderAnnotation(dataRoot, payload.annotation || payload, {
          expectedUpdatedAt: payload.expectedUpdatedAt,
          updatedAt: payload.updatedAt
        });
        return { ok: true, record };
      });
    }

    if (request.method === 'POST' && pathname === '/api/reader/annotations/delete') {
      return respond(response, async () => {
        const payload = await readJsonPayload(request);
        const result = await readerAnnotationStore.deleteReaderAnnotation(dataRoot, payload.documentId, payload.annotationId, {
          expectedUpdatedAt: payload.expectedUpdatedAt,
          updatedAt: payload.updatedAt
        });
        return { ok: true, ...result };
      });
    }

    if (request.method === 'GET' && pathname === '/api/reader/history') {
      return respond(response, async () => {
        const record = await readerAnnotationStore.readReaderPositionHistory(dataRoot);
        const documentId = cleanString(parsedUrl.searchParams.get('documentId'));
        if (!record || !documentId) return { ok: true, record };
        return { ok: true, record: { ...record, history: { ...record.history, items: record.history.items.filter((item) => item.documentId === documentId) } } };
      });
    }

    if (request.method === 'POST' && pathname === '/api/reader/history') {
      return respond(response, async () => {
        const payload = await readJsonPayload(request);
        const record = await readerAnnotationStore.appendReaderPositionHistory(dataRoot, payload.entry || payload, {
          expectedUpdatedAt: payload.expectedUpdatedAt,
          updatedAt: payload.updatedAt
        });
        return { ok: true, record };
      });
    }

    if (request.method === 'GET' && pathname === '/api/reader/transfers') {
      return respond(response, async () => ({ ok: true, ...(await readerTransferService.listTransfers(dataRoot)) }));
    }

    if (request.method === 'GET' && pathname === '/api/reader/transfer') {
      return respond(response, async () => {
        const envelopeId = cleanString(parsedUrl.searchParams.get('envelopeId'));
        if (!envelopeId) throw new Error('reader envelopeId is required');
        const transfer = await readerTransferService.readTransfer(dataRoot, envelopeId);
        if (!transfer) throw new Error('reader transfer not found');
        return { ok: true, transfer };
      });
    }

    if (request.method === 'GET' && pathname === '/api/reader/transfer/freshness') {
      return respond(response, async () => {
        const envelopeId = cleanString(parsedUrl.searchParams.get('envelopeId'));
        if (!envelopeId) throw new Error('reader envelopeId is required');
        return { ok: true, freshness: await readerTransferService.freshness(dataRoot, envelopeId) };
      });
    }

    if (request.method === 'POST' && pathname === '/api/reader/transfer') {
      return respond(response, async () => {
        const payload = await readJsonPayload(request);
        const created = await readerTransferService.createTransfer(dataRoot, payload);
        return { ok: true, envelope: created.envelope };
      });
    }

    if (request.method === 'POST' && pathname === '/api/reader/transfer/range') {
      return respond(response, async () => {
        const payload = await readJsonPayload(request);
        const created = await readerTransferService.createTransferFromRange(dataRoot, payload);
        return {
          ok: true,
          envelope: created.envelope,
          summary: {
            sourceTitle: created.snapshot.sourceTitle,
            characterCount: created.envelope.characterCount,
            sectionCount: created.snapshot.sections.length,
            sceneCount: created.snapshot.sourceUnits.filter((unit) => unit.kind === 'scene').length
          }
        };
      });
    }

    if (request.method === 'POST' && pathname === '/api/reader/transfer/consumer') {
      return respond(response, async () => {
        const payload = await readJsonPayload(request);
        const envelope = await readerTransferService.addConsumer(
          dataRoot,
          payload.envelopeId,
          payload.consumer,
          { expectedUpdatedAt: payload.expectedUpdatedAt }
        );
        return { ok: true, envelope };
      });
    }

    if (request.method === 'POST' && pathname === '/api/reader/transfer/consumer/update') {
      return respond(response, async () => {
        const payload = await readJsonPayload(request);
        const envelope = await readerTransferService.updateConsumer(
          dataRoot,
          payload.envelopeId,
          payload.consumerId,
          payload.changes,
          { expectedUpdatedAt: payload.expectedUpdatedAt }
        );
        return { ok: true, envelope };
      });
    }

    if (request.method === 'POST' && pathname === '/api/reader/transfer/consumer/materialize') {
      return respond(response, async () => {
        const payload = await readJsonPayload(request);
        const envelope = await readerTransferService.materializeConsumer(dataRoot, payload.envelopeId, payload.consumer || payload);
        return { ok: true, envelope };
      });
    }

    if (request.method === 'POST' && pathname === '/api/reader/transfer/lifecycle') {
      return respond(response, async () => {
        const payload = await readJsonPayload(request);
        const envelope = await readerTransferService.transition(dataRoot, payload.envelopeId, payload.lifecycle, {
          expectedUpdatedAt: payload.expectedUpdatedAt,
          updatedAt: payload.updatedAt
        });
        return { ok: true, envelope };
      });
    }

    if (request.method === 'POST' && pathname === '/api/reader/transfer/delete') {
      return respond(response, async () => {
        const payload = await readJsonPayload(request);
        return { ok: true, deleted: await readerTransferService.deleteArchived(dataRoot, payload.envelopeId) };
      });
    }

    const importActions = {
      '/api/reader/import/file-preview': async (payload) => readerLibraryService.previewFileImport(payload),
      '/api/reader/import/file-preview-bytes': async (payload) => readerLibraryService.previewBytesImport(payload),
      '/api/reader/import/paste-preview': async (payload) => readerLibraryService.previewPastedImport(payload),
      '/api/reader/import/retry': async (payload) => readerLibraryService.retryImportDraft(payload.draftId, payload),
      '/api/reader/import/correct': async (payload) => readerLibraryService.correctImportDraft(payload.draftId, payload.corrections || payload),
      '/api/reader/import/split': async (payload) => readerLibraryService.splitImportChapter(payload.draftId, payload),
      '/api/reader/import/merge': async (payload) => readerLibraryService.mergeImportChapters(payload.draftId, payload),
      '/api/reader/import/discard': async (payload) => ({ discarded: readerLibraryService.discardImportDraft(payload.draftId) })
    };
    if (request.method === 'POST' && importActions[pathname]) {
      return respond(response, async () => {
        const payload = await readJsonPayload(request);
        const result = await importActions[pathname](payload);
        return result && result.kind === 'reader-import-draft'
          ? { ok: true, draft: result }
          : { ok: true, ...result };
      });
    }

    if (request.method === 'POST' && pathname === '/api/reader/import/confirm') {
      return respond(response, async () => {
        const payload = await readJsonPayload(request);
        const committed = await readerLibraryService.confirmImportDraft(dataRoot, payload.draftId, payload);
        return {
          ok: true,
          draftId: committed.draftId,
          documentId: committed.documentId,
          revisionId: committed.revisionId,
          reimported: committed.reimported,
          sourceCopied: committed.sourceCopied,
          metadata: committed.metadata,
          index: committed.index
        };
      });
    }

    if (request.method === 'GET' && pathname === '/api/reader/migration') {
      return respond(response, async () => ({
        ok: true,
        migration: await readerMigrationService.readMigrationRecord(dataRoot)
      }));
    }

    if (request.method === 'POST' && pathname === '/api/reader/migration') {
      return respond(response, async () => {
        const payload = await readJsonPayload(request);
        const migration = await readerMigrationService.migrateLegacyReaderState(
          dataRoot,
          payload.legacyState === undefined ? payload.legacyRaw : payload.legacyState,
          { externalAction: payload.externalAction }
        );
        return { ok: migration.status !== 'failed', migration };
      });
    }

    return false;
  };
}

module.exports = { createController };
