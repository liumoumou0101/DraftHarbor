const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');

const manuscriptBuilder = require('../../src/core/document/manuscript-builder');
const { normalizeProject } = require('../../src/core/project/project-normalize');
const projectStore = require('../storage/project-file-store');
const libraryPaths = require('../storage/library-paths');
const { legacySnapshotToProject, projectToLegacySnapshot } = require('./project-snapshot-adapter');

function slug(value, fallback = 'project') {
  return libraryPaths.sanitizePathSegment(value, fallback).replace(/\s+/g, '-');
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function uniqueProjectId(dataRoot, preferredId) {
  const base = slug(preferredId || `project-${Date.now()}`, 'project').toLowerCase();
  let candidate = base;
  let index = 2;
  while (await pathExists(libraryPaths.projectDir(dataRoot, candidate))) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

function withProjectId(project, projectId, titleSuffix = '') {
  const now = new Date().toISOString();
  return normalizeProject({
    ...project,
    id: projectId,
    title: `${project.title || 'Imported Project'}${titleSuffix}`,
    updatedAt: now,
    chapters: (project.chapters || []).map((chapter) => ({ ...chapter })),
    scenes: (project.scenes || []).map((scene) => ({ ...scene })),
    compendium: (project.compendium || []).map((entry) => ({ ...entry, projectId })),
    prompts: (project.prompts || []).map((prompt) => ({ ...prompt, projectId })),
    workshopSessions: (project.workshopSessions || []).map((session) => ({ ...session, projectId })),
    workflowRuns: (project.workflowRuns || []).map((run) => ({ ...run, projectId }))
  });
}

function projectFilename(project, extension) {
  return `${slug(project.title || project.name || project.id || 'project')}.${extension}`;
}

function buildTextManuscript(project, options = {}) {
  const includeSceneTitles = options.includeSceneTitles !== false;
  const normalized = normalizeProject(project);
  const lines = [];
  for (const chapter of normalized.chapters || []) {
    lines.push(chapter.title || 'Untitled Chapter');
    const chapterScenes = (normalized.scenes || []).filter((scene) => scene.chapterId === chapter.id);
    for (const scene of chapterScenes) {
      if (includeSceneTitles && scene.title) lines.push('', scene.title);
      if (scene.content) lines.push('', String(scene.content).trim());
    }
    lines.push('');
  }
  return `${lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim()}\n`;
}

function buildMarkdownManuscript(project, options = {}) {
  return `${manuscriptBuilder.buildManuscript(normalizeProject(project), {
    includeSceneTitles: options.includeSceneTitles !== false
  })}\n`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function paragraphsToHtml(text, breakTag = '<br>') {
  return String(text || '')
    .split(/\n{2,}/)
    .filter((paragraph) => paragraph.trim())
    .map((paragraph) => `<p>${escapeHtml(paragraph.trim()).replace(/\n/g, breakTag)}</p>`)
    .join('\n');
}

function buildHtmlManuscript(project, options = {}) {
  const includeSceneTitles = options.includeSceneTitles !== false;
  const normalized = normalizeProject(project);
  const parts = [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<title>${escapeHtml(normalized.title || 'Untitled')}</title>`,
    '<style>',
    'body{font-family:Georgia,"Microsoft YaHei",serif;line-height:1.85;max-width:820px;margin:0 auto;padding:42px 24px;background:#fafafa;color:#222;}',
    'h1{text-align:center;font-size:2.4em;margin:0 0 1.2em;}',
    'h2{font-size:1.7em;margin:2.2em 0 .8em;border-bottom:1px solid #aaa;padding-bottom:.25em;}',
    'h3{font-size:1.15em;margin:1.6em 0 .4em;color:#666;font-style:italic;}',
    'p{margin:1em 0;text-align:justify;}',
    '.scene-break{text-align:center;margin:2em 0;letter-spacing:.8em;color:#777;}',
    '@media print{body{background:white;}h2{page-break-before:always;}}',
    '</style>',
    '</head>',
    '<body>',
    `<h1>${escapeHtml(normalized.title || 'Untitled')}</h1>`
  ];
  for (const chapter of normalized.chapters || []) {
    parts.push(`<h2>${escapeHtml(chapter.title || 'Untitled Chapter')}</h2>`);
    const chapterScenes = (normalized.scenes || []).filter((scene) => scene.chapterId === chapter.id);
    chapterScenes.forEach((scene, index) => {
      if (includeSceneTitles && scene.title) parts.push(`<h3>${escapeHtml(scene.title)}</h3>`);
      if (!includeSceneTitles && index > 0) parts.push('<div class="scene-break">* * *</div>');
      if (scene.content) parts.push(paragraphsToHtml(scene.content));
    });
  }
  parts.push('</body>', '</html>');
  return `${parts.join('\n')}\n`;
}

async function buildEpub(project, options = {}) {
  const includeSceneTitles = options.includeSceneTitles !== false;
  const normalized = normalizeProject(project);
  const zip = new JSZip();
  const title = normalized.title || 'Untitled';
  const uuid = `ww-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);
  const chapters = normalized.chapters || [];
  const manifestItems = [];
  const spineItems = [];
  const navPoints = [];
  chapters.forEach((chapter, chapterIndex) => {
    const id = `chapter${chapterIndex + 1}`;
    const filename = `${id}.xhtml`;
    const body = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE html>',
      '<html xmlns="http://www.w3.org/1999/xhtml">',
      '<head>',
      `<title>${escapeHtml(chapter.title || `Chapter ${chapterIndex + 1}`)}</title>`,
      '<link rel="stylesheet" type="text/css" href="stylesheet.css"/>',
      '</head>',
      '<body>',
      `<h1>${escapeHtml(chapter.title || `Chapter ${chapterIndex + 1}`)}</h1>`
    ];
    const chapterScenes = (normalized.scenes || []).filter((scene) => scene.chapterId === chapter.id);
    chapterScenes.forEach((scene, sceneIndex) => {
      if (includeSceneTitles && scene.title) body.push(`<h2>${escapeHtml(scene.title)}</h2>`);
      if (!includeSceneTitles && sceneIndex > 0) body.push('<p class="scene-break">* * *</p>');
      if (scene.content) body.push(paragraphsToHtml(scene.content, '<br/>'));
    });
    body.push('</body>', '</html>');
    zip.file(`OEBPS/${filename}`, body.join('\n'));
    manifestItems.push(`<item id="${id}" href="${filename}" media-type="application/xhtml+xml"/>`);
    spineItems.push(`<itemref idref="${id}"/>`);
    navPoints.push(`<navPoint id="navpoint-${chapterIndex + 1}" playOrder="${chapterIndex + 1}"><navLabel><text>${escapeHtml(chapter.title || `Chapter ${chapterIndex + 1}`)}</text></navLabel><content src="${filename}"/></navPoint>`);
  });
  zip.file('OEBPS/stylesheet.css', 'body{font-family:serif;line-height:1.8;margin:2em;}h1{text-align:center;}h2{font-style:italic;}p{text-indent:1.5em;margin:1em 0;}.scene-break{text-align:center;text-indent:0;margin:2em 0;}');
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uuid_id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uuid_id">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${escapeHtml(title)}</dc:title>
    <dc:language>zh-CN</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString()}</meta>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="stylesheet" href="stylesheet.css" media-type="text/css"/>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine toc="ncx">
    ${spineItems.join('\n    ')}
  </spine>
</package>`);
  zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:${uuid}"/></head>
  <docTitle><text>${escapeHtml(title)}</text></docTitle>
  <navMap>${navPoints.join('\n')}</navMap>
</ncx>`);
  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip', compression: 'DEFLATE' });
}

function exportDocument(project, format = 'markdown', options = {}) {
  const normalized = normalizeProject(project);
  const normalizedFormat = String(format || 'markdown').toLowerCase();
  if (normalizedFormat === 'html') {
    return {
      filename: projectFilename(normalized, 'html'),
      mimeType: 'text/html; charset=utf-8',
      text: buildHtmlManuscript(normalized, options)
    };
  }
  const markdown = normalizedFormat === 'markdown' || normalizedFormat === 'md';
  const text = markdown ? buildMarkdownManuscript(normalized, options) : buildTextManuscript(normalized, options);
  return {
    filename: projectFilename(normalized, markdown ? 'md' : 'txt'),
    mimeType: markdown ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8',
    text
  };
}

async function exportProjectDocument(dataRoot, projectId, format = 'markdown', options = {}) {
  const project = await projectStore.openProject(dataRoot, projectId);
  if (String(format || '').toLowerCase() === 'epub') {
    return {
      filename: projectFilename(project, 'epub'),
      mimeType: 'application/epub+zip',
      body: await buildEpub(project, options)
    };
  }
  return exportDocument(project, format, options);
}

async function addDirectoryToZip(zip, sourceDir, prefix = '') {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const zipPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await addDirectoryToZip(zip, sourcePath, zipPath);
    } else if (entry.isFile()) {
      zip.file(zipPath, await fs.readFile(sourcePath));
    }
  }
}

async function exportProjectPackage(dataRoot, projectId) {
  const project = await projectStore.openProject(dataRoot, projectId);
  const projectPath = libraryPaths.projectDir(dataRoot, project.id);
  const zip = new JSZip();
  zip.file('writingway-package.json', JSON.stringify({
    format: 'writingway-project-directory',
    version: 1,
    exportedAt: new Date().toISOString(),
    projectId: project.id,
    title: project.title
  }, null, 2));
  await addDirectoryToZip(zip, projectPath);
  return {
    filename: projectFilename(project, 'writingway-project.zip'),
    mimeType: 'application/zip',
    buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  };
}

async function safeExtractZip(zip, targetDir, rootPrefix) {
  const root = path.resolve(targetDir);
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (rootPrefix && !name.startsWith(rootPrefix)) continue;
    const relative = rootPrefix ? name.slice(rootPrefix.length) : name;
    if (!relative || relative.includes('\0')) continue;
    const target = path.resolve(targetDir, relative);
    if (!target.startsWith(`${root}${path.sep}`) && target !== root) {
      throw new Error(`Unsafe zip entry: ${name}`);
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, await entry.async('nodebuffer'));
  }
}

function findProjectRootPrefix(zip) {
  if (zip.file('manifest.json')) return '';
  const manifestName = Object.keys(zip.files).find((name) => /(^|\/)manifest\.json$/i.test(name));
  if (!manifestName) return '';
  return manifestName.slice(0, manifestName.length - 'manifest.json'.length);
}

async function importProjectPackage(dataRoot, buffer, options = {}) {
  const zip = await JSZip.loadAsync(buffer);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'writingway-import-package-'));
  try {
    const rootPrefix = findProjectRootPrefix(zip);
    await safeExtractZip(zip, tempDir, rootPrefix);
    const project = await projectStore.readProject(tempDir);
    const projectId = options.keepId ? project.id : await uniqueProjectId(dataRoot, project.id);
    const normalized = withProjectId(project, projectId, projectId === project.id ? '' : ' (Imported)');
    const saved = await projectStore.createProject(dataRoot, normalized);
    return {
      ok: true,
      project: saved.project,
      projectPath: saved.projectPath,
      importedFrom: 'project-package'
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function importLegacySnapshot(dataRoot, snapshot, options = {}) {
  const project = legacySnapshotToProject(snapshot);
  const projectId = options.keepId ? project.id : await uniqueProjectId(dataRoot, project.id);
  const normalized = withProjectId(project, projectId, projectId === project.id ? '' : ' (Imported)');
  const saved = await projectStore.createProject(dataRoot, normalized);
  return {
    ok: true,
    project: saved.project,
    projectPath: saved.projectPath,
    snapshot: projectToLegacySnapshot(saved.project),
    importedFrom: 'legacy-snapshot'
  };
}

function stripHtml(input) {
  return String(input || '')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function fileBaseName(filePath) {
  return String(filePath || '').split(/[\\/]/).pop() || '';
}

function latestMatchingSceneFile(files, projectName, actName, chapterName, sceneName) {
  const compact = (value) => String(value || '').replace(/\s+/g, '');
  const pattern = `${compact(projectName)}-${compact(actName)}-${compact(chapterName)}-${compact(sceneName)}`;
  return files
    .filter((file) => {
      const name = fileBaseName(file.path);
      return name.startsWith(pattern) && /\.(html|txt)$/i.test(name);
    })
    .sort((a, b) => {
      const at = fileBaseName(a.path).match(/_(\d+)\.(html|txt)$/i)?.[1] || '0';
      const bt = fileBaseName(b.path).match(/_(\d+)\.(html|txt)$/i)?.[1] || '0';
      return bt.localeCompare(at);
    })[0] || null;
}

async function importWritingway1Files(dataRoot, files, options = {}) {
  const normalizedFiles = (Array.isArray(files) ? files : [])
    .map((file) => ({
      path: String(file.path || file.name || ''),
      text: String(file.text || '')
    }))
    .filter((file) => file.path);
  const structureFile = normalizedFiles.find((file) => file.path.endsWith('_structure.json'));
  if (!structureFile) throw new Error('Could not find Writingway 1 *_structure.json');

  const projectName = options.name || fileBaseName(structureFile.path).replace(/_structure\.json$/i, '') || 'Writingway 1 Project';
  const structure = JSON.parse(structureFile.text);
  const compendiumFile = normalizedFiles.find((file) => /(^|\/)compendium\.json$/i.test(file.path));
  const compendium = compendiumFile ? JSON.parse(compendiumFile.text) : null;
  const now = new Date().toISOString();
  const projectId = await uniqueProjectId(dataRoot, slug(projectName).toLowerCase());
  const chapters = [];
  const scenes = [];

  let chapterOrder = 0;
  for (const act of structure.acts || []) {
    for (const chapter of act.chapters || []) {
      const chapterId = `chapter-${chapterOrder + 1}`;
      const chapterTitle = act.name && act.name !== 'Act 1' ? `${act.name} - ${chapter.name || `Chapter ${chapterOrder + 1}`}` : (chapter.name || `Chapter ${chapterOrder + 1}`);
      chapters.push({
        id: chapterId,
        title: chapterTitle,
        order: chapterOrder,
        createdAt: now,
        updatedAt: now
      });
      let sceneOrder = 0;
      for (const scene of chapter.scenes || []) {
        const sceneFile = latestMatchingSceneFile(normalizedFiles, projectName, act.name || '', chapter.name || '', scene.name || '');
        const rawText = sceneFile ? sceneFile.text : '';
        scenes.push({
          id: `scene-${chapterOrder + 1}-${sceneOrder + 1}`,
          chapterId,
          title: scene.name || `Scene ${sceneOrder + 1}`,
          summary: '',
          content: /\.html$/i.test(sceneFile && sceneFile.path || '') ? stripHtml(rawText) : rawText.trim(),
          order: sceneOrder,
          tags: [],
          povCharacter: scene.pov || '',
          tense: 'past',
          createdAt: now,
          updatedAt: now
        });
        sceneOrder += 1;
      }
      chapterOrder += 1;
    }
  }

  const entries = [];
  const categoryMap = {
    Characters: 'character',
    Locations: 'location',
    Items: 'item',
    Placeholder: 'note'
  };
  for (const category of compendium && compendium.categories ? compendium.categories : []) {
    for (const entry of category.entries || []) {
      entries.push({
        id: `w1-entry-${entries.length + 1}`,
        projectId,
        type: categoryMap[category.name] || 'note',
        title: entry.name || 'Untitled',
        aliases: [],
        tags: [],
        summary: '',
        content: stripHtml(entry.content || ''),
        includeInContext: false,
        createdAt: now,
        updatedAt: now
      });
    }
  }

  const project = normalizeProject({
    id: projectId,
    title: `${projectName} (Imported)`,
    createdAt: now,
    updatedAt: now,
    chapters,
    scenes,
    compendium: entries
  });
  const saved = await projectStore.createProject(dataRoot, project);
  return {
    ok: true,
    project: saved.project,
    projectPath: saved.projectPath,
    importedFrom: 'writingway-1',
    chapterCount: chapters.length,
    sceneCount: scenes.length
  };
}

module.exports = {
  exportDocument,
  exportProjectDocument,
  exportProjectPackage,
  importProjectPackage,
  importLegacySnapshot,
  importWritingway1Files,
  uniqueProjectId
};
