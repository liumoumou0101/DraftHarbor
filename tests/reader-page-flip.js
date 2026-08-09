const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const bundle = read('src/vendor/page-flip-2.0.7/page-flip.browser.js');
const adapter = read('src/desktop/shell/reader-page-flip.js');
const reading = read('src/desktop/shell/reader-reading.js');
const packageJson = JSON.parse(read('package.json'));

assert.ok(bundle.includes('this.render.stop()'), 'vendored StPageFlip destroy must stop its render loop');
assert.ok(bundle.includes('cancelAnimationFrame(this.animationFrameId)'), 'vendored StPageFlip must cancel its pending animation frame');
assert.ok(adapter.includes('global.St && global.St.PageFlip'), 'adapter must fail closed when StPageFlip is unavailable');
assert.ok(adapter.includes("content.classList.add('is-reader-page-flip-active')"), 'adapter must keep the authoritative Reader DOM mounted during animation');
assert.ok(adapter.indexOf("content.classList.add('is-reader-page-flip-active')") > adapter.indexOf('pageFlip.loadFromHTML(sheets)'), 'authoritative content must remain visible until PageFlip has rendered its first frame');
assert.ok(adapter.includes('pageFlip?.destroy()'), 'adapter must destroy each temporary PageFlip instance');
assert.ok(adapter.includes('global.stopReaderPageFlip'), 'Reader settings and reflows must be able to cancel an active PageFlip session');
assert.ok(reading.includes("transition === 'curl'") && reading.includes('window.startReaderPageFlip'), 'Reader must limit the adapter to curl transitions');
assert.ok(!Object.prototype.hasOwnProperty.call(packageJson.dependencies, 'page-flip'), 'vendored browser code must not pull the oversized npm package into production');
assert.ok(Buffer.byteLength(adapter, 'utf8') < 12 * 1024, 'page-flip adapter must remain independently bounded');

console.log('Reader page-flip integration tests passed.');
