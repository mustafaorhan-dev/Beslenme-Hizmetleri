const fs = require('fs');
const path = require('path');
let JavaScriptObfuscator = null;
try { JavaScriptObfuscator = require('javascript-obfuscator'); } catch (e) {
  try { JavaScriptObfuscator = require('@javascript-obfuscator/javascript-obfuscator'); } catch (e2) {}
}
let minify = null;
try { minify = require('terser').minify; } catch (e) {}

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const OBFUSCATE = process.argv.includes('--obfuscate');

const targets = ['app.js', 'config.js', 'sw.js'];

if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });

(async () => {
  for (const f of targets) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    let code = src;
    // 1. Minify (if terser available)
    if (minify) {
      const m = await minify(code, { compress: true, mangle: true, format: { comments: false } });
      code = m.code || code;
    }
    // 2. Obfuscate (optional, stronger)
    if (OBFUSCATE && JavaScriptObfuscator) {
      const obf = JavaScriptObfuscator.obfuscate(code, {
        compact: true,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.75,
        deadCodeInjection: true,
        deadCodeInjectionThreshold: 0.4,
        debugProtection: false,
        disableConsoleOutput: true,
        identifierNamesGenerator: 'hexadecimal',
        renameGlobals: false,
        rotateStringArray: true,
        selfDefending: true,
        stringArray: true,
        stringArrayEncoding: ['base64'],
        stringArrayThreshold: 0.75,
        transformObjectKeys: true,
        unicodeEscapeSequence: false
      });
      code = obf.getObfuscatedCode();
    } else if (OBFUSCATE) {
      console.log('javascript-obfuscator not available; minify only.');
    }
    fs.writeFileSync(path.join(DIST, f), code, 'utf8');
    console.log(`Built ${f} -> dist/${f} (${code.length} bytes)`);
  }
  // Copy static assets
  for (const a of ['index.html', 'style.css', 'manifest.json', 'logo.png']) {
    if (fs.existsSync(path.join(ROOT, a))) {
      fs.copyFileSync(path.join(ROOT, a), path.join(DIST, a));
      console.log(`Copied ${a}`);
    }
  }
  console.log('Build complete.');
})();
