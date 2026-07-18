const crypto = require('crypto');
const ProjectSchema = require('../../src/core/project/project-schema');

function cleanString(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function stableId(prefix, value) {
  return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16)}`;
}

function sourceItems(transfer) {
  let cursor = 0;
  return transfer.snapshot.sections.map((section, index) => {
    const length = Number(section.characterCount) || 0;
    let text;
    if (Number.isInteger(section.textStart) && Number.isInteger(section.textEnd) && section.textEnd >= section.textStart) {
      text = transfer.text.slice(section.textStart, section.textEnd);
    } else {
      const heading = transfer.snapshot.sections.length > 1 ? `# ${section.title}\n\n` : '';
      if (heading && transfer.text.slice(cursor, cursor + heading.length) === heading) cursor += heading.length;
      text = transfer.text.slice(cursor, cursor + length);
      cursor += length;
      if (transfer.text.slice(cursor, cursor + 2) === '\n\n') cursor += 2;
    }
    return {
      itemId: section.sectionId,
      title: section.title || `来源片段 ${index + 1}`,
      chapterId: section.chapterId || '',
      sceneId: section.sceneId || '',
      characterCount: text.length,
      text
    };
  });
}

function locateProjectSource(envelope, project) {
  const locators = envelope.sourceLocators || [];
  const sceneIds = new Set((project.scenes || []).map((scene) => scene.id));
  const exact = locators.map((locator) => locator.projectRef && locator.projectRef.sceneId).filter(Boolean);
  if (exact.length && exact.every((sceneId) => sceneIds.has(sceneId))) {
    return { accuracy: 'exact', sceneId: exact[0], locator: locators[0], message: '来源场景仍存在，可精确定位。' };
  }
  for (const locator of locators) {
    const chapterId = locator.projectRef && locator.projectRef.chapterId;
    const fallback = (project.scenes || []).find((scene) => scene.chapterId === chapterId);
    if (fallback) return { accuracy: 'approximate', sceneId: fallback.id, locator, message: '原场景已变化，将近似定位到同章场景，必须确认。' };
  }
  return { accuracy: 'missing', sceneId: '', locator: locators[0] || null, message: '原项目位置已无法解析，仍可使用冻结快照导入。' };
}

function createReaderWriterTransferService({ readerTransferService, projectService, createBackup } = {}) {
  if (!readerTransferService || !projectService || !createBackup) throw new Error('reader writer transfer dependencies are required');

  async function preview(dataRoot, request = {}) {
    const envelopeId = cleanString(request.envelopeId);
    const applicationId = cleanString(request.applicationId) || stableId('reader-writer-application', envelopeId);
    const intent = cleanString(request.intent || 'locate');
    if (!envelopeId) throw new Error('reader writer transfer envelopeId is required');
    if (!['locate', 'append', 'replace', 'new-scenes', 'new-project'].includes(intent)) throw new Error(`reader writer intent is not supported: ${intent}`);
    const transfer = await readerTransferService.readTransfer(dataRoot, envelopeId);
    if (transfer.envelope.destination !== 'writer') throw new Error('reader transfer destination must be writer');
    const items = sourceItems(transfer);
    const targetProjectId = cleanString(request.targetProjectId);
    let project = null;
    if (intent !== 'new-project') {
      if (!targetProjectId) throw new Error('targetProjectId is required');
      project = (await projectService.openProject(dataRoot, targetProjectId)).project;
    }
    const targetSceneId = cleanString(request.targetSceneId || (project && project.currentSceneId));
    const targetScene = project && project.scenes.find((scene) => scene.id === targetSceneId);
    const targetChapterId = cleanString(request.targetChapterId || (targetScene && targetScene.chapterId) || (project && project.chapters[0] && project.chapters[0].id));
    const location = project && transfer.envelope.sourceKind === 'project' && transfer.envelope.suggestedProjectId === project.id
      ? locateProjectSource(transfer.envelope, project)
      : { accuracy: 'not-applicable', sceneId: '', locator: transfer.envelope.sourceLocators[0] || null, message: '外部快照将通过写前预览导入。' };
    const conflicts = [];
    if (['append', 'replace'].includes(intent) && !targetScene) conflicts.push('目标场景不存在');
    if (intent === 'replace' && targetScene && targetScene.content) conflicts.push(`将覆盖目标场景现有的 ${targetScene.content.length} 个字符`);
    if (intent === 'append' && targetScene && targetScene.content) conflicts.push(`将在目标场景现有 ${targetScene.content.length} 个字符后追加`);
    if (intent === 'locate' && location.accuracy === 'approximate') conflicts.push('定位结果为近似匹配');
    if (intent === 'locate' && location.accuracy === 'missing') conflicts.push('来源位置已经丢失');
    return {
      applicationId,
      envelope: transfer.envelope,
      freshness: transfer.freshness,
      sourceTitle: transfer.snapshot.sourceTitle,
      items,
      intent,
      location,
      targetProject: project ? { id: project.id, title: project.title, updatedAt: project.updatedAt } : null,
      targetSceneId,
      targetChapterId,
      newProjectTitle: cleanString(request.newProjectTitle || transfer.snapshot.sourceTitle || '阅读器导入'),
      conflicts,
      requiresConfirmation: intent !== 'locate' || location.accuracy !== 'exact'
    };
  }

  async function materializeApplicationConsumer(dataRoot, transfer, applicationId, projectId, targetSceneIds, appliedAt) {
    return readerTransferService.materializeConsumer(dataRoot, transfer.envelope.envelopeId, {
      consumerId: `writer-application:${applicationId}`,
      destination: 'writer',
      referenceId: `writer-project:${projectId}:${targetSceneIds.join(',') || 'location'}`,
      createdAt: appliedAt,
      materializedAt: appliedAt
    });
  }

  async function apply(dataRoot, request = {}) {
    if (request.confirmed !== true) throw new Error('reader writer application requires explicit confirmation');
    const prepared = await preview(dataRoot, request);
    if (prepared.intent === 'locate') {
      if (!['exact', 'approximate'].includes(prepared.location.accuracy)) throw new Error('reader writer source location is unavailable');
      const appliedAt = cleanString(request.appliedAt) || new Date().toISOString();
      await materializeApplicationConsumer(dataRoot, prepared, prepared.applicationId, prepared.targetProject.id, [prepared.location.sceneId], appliedAt);
      return { ok: true, applied: false, idempotent: true, preview: prepared, projectId: prepared.targetProject.id, backup: null, targetSceneIds: [prepared.location.sceneId] };
    }
    const selectedIds = new Set(Array.isArray(request.selectedItemIds) ? request.selectedItemIds.map(cleanString).filter(Boolean) : prepared.items.map((item) => item.itemId));
    prepared.items = prepared.items.filter((item) => selectedIds.has(item.itemId));
    if (!prepared.items.length) throw new Error('at least one source section must be selected');
    let project;
    let createdProject = false;
    if (prepared.intent === 'new-project') {
      const projectId = cleanString(request.newProjectId) || stableId('reader-import-project', prepared.applicationId);
      try {
        project = (await projectService.openProject(dataRoot, projectId)).project;
      } catch {
        project = ProjectSchema.createProject({ id: projectId, title: prepared.newProjectTitle });
        createdProject = true;
      }
    } else {
      project = (await projectService.openProject(dataRoot, prepared.targetProject.id)).project;
    }
    const existing = (project.readerApplications || []).find((item) => item.applicationId === prepared.applicationId);
    if (existing) {
      if (existing.envelopeId !== prepared.envelope.envelopeId || existing.mode !== prepared.intent) throw new Error('reader writer application identity conflict');
      await materializeApplicationConsumer(dataRoot, prepared, prepared.applicationId, project.id, existing.targetSceneIds, existing.appliedAt);
      return { ok: true, applied: true, idempotent: true, projectId: project.id, targetSceneIds: existing.targetSceneIds, backup: existing.backupId ? { backupId: existing.backupId } : null };
    }
    if (!createdProject && cleanString(request.expectedTargetUpdatedAt) !== project.updatedAt) throw new Error('target project changed after preview');
    const now = cleanString(request.appliedAt) || new Date().toISOString();
    const sourceReference = (item) => ({
      kind: 'reader-transfer', envelopeId: prepared.envelope.envelopeId, applicationId: prepared.applicationId,
      mode: prepared.intent, locator: prepared.envelope.sourceLocators[0] || null, appliedAt: now, itemId: item.itemId
    });
    const targetSceneIds = [];
    if (prepared.intent === 'new-project') {
      project.chapters = prepared.items.map((item, index) => ({
        id: stableId('reader-chapter', `${prepared.applicationId}:${item.itemId}`), title: item.title || `章节 ${index + 1}`,
        summary: '', order: index, sceneIds: [], createdAt: now, updatedAt: now
      }));
      project.scenes = prepared.items.map((item, index) => {
        const id = stableId('reader-scene', `${prepared.applicationId}:${item.itemId}`);
        targetSceneIds.push(id);
        return { id, chapterId: project.chapters[index].id, title: item.title || `场景 ${index + 1}`, summary: '', content: item.text, order: index, tags: [], povCharacter: '', tense: '', sourceReferences: [sourceReference(item)], createdAt: now, updatedAt: now };
      });
      project.currentSceneId = targetSceneIds[0] || '';
    } else if (prepared.intent === 'new-scenes') {
      if (!project.chapters.some((chapter) => chapter.id === prepared.targetChapterId)) throw new Error('target chapter no longer exists');
      prepared.items.forEach((item, index) => {
        const id = stableId('reader-scene', `${prepared.applicationId}:${item.itemId}`);
        targetSceneIds.push(id);
        project.scenes.push({ id, chapterId: prepared.targetChapterId, title: item.title || `导入场景 ${index + 1}`, summary: '', content: item.text, order: project.scenes.length, tags: [], povCharacter: '', tense: '', sourceReferences: [sourceReference(item)], createdAt: now, updatedAt: now });
      });
    } else {
      const scene = project.scenes.find((item) => item.id === prepared.targetSceneId);
      if (!scene) throw new Error('target scene no longer exists');
      const sourceText = prepared.items.map((item) => item.text).join('\n\n');
      scene.content = prepared.intent === 'append' && scene.content ? `${scene.content}\n\n${sourceText}` : sourceText;
      scene.sourceReferences = [...(scene.sourceReferences || []), sourceReference(prepared.items[0])];
      scene.updatedAt = now;
      targetSceneIds.push(scene.id);
    }
    project.updatedAt = now;
    let backup = null;
    if (!createdProject) backup = (await createBackup(dataRoot, project.id, `Before applying Reader envelope ${prepared.envelope.envelopeId}`, 'before-reader-writer-application')).backup;
    project.readerApplications = [...(project.readerApplications || []), {
      applicationId: prepared.applicationId, envelopeId: prepared.envelope.envelopeId, mode: prepared.intent,
      targetSceneIds, backupId: backup && backup.backupId || '', appliedAt: now
    }];
    const saved = createdProject ? await projectService.createProject(dataRoot, project) : await projectService.saveProject(dataRoot, project);
    await materializeApplicationConsumer(dataRoot, prepared, prepared.applicationId, saved.project.id, targetSceneIds, now);
    return { ok: true, applied: true, idempotent: false, projectId: saved.project.id, targetSceneIds, backup };
  }

  return { preview, apply, sourceItems, locateProjectSource };
}

module.exports = { createReaderWriterTransferService, sourceItems, locateProjectSource, stableId };
