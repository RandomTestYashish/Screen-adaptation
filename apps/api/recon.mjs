import sharp from 'sharp';
const { reconstructRaster } = await import('@dae/engine');
const { measured, PARSER_VERSION } = await import('@dae/shared');

const file = process.argv[2];
const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const image = { data: new Uint8ClampedArray(data), width: info.width, height: info.height };

const source = {
  id: 'src_test', projectId: 'p', kind: 'raster', name: file.split('/').pop(),
  mimeType: 'image/png', byteSize: 1, hash: 'a'.repeat(64), assetId: 'asset_1',
  width: info.width, height: info.height, pixelWidth: info.width, pixelHeight: info.height,
  exportScale: 1, exportScaleProvenance: measured('raster-pixels', 1),
  importedAt: new Date().toISOString(), parserVersion: PARSER_VERSION, immutable: true,
};

const r = reconstructRaster({ source, image });
console.log(`\n=== ${source.name}  ${info.width}x${info.height} ===`);
console.log(`regions: ${r.regions.length} | structural coverage: ${(r.structuralCoverage*100).toFixed(1)}% | ${r.timings.totalMs.toFixed(0)}ms`);
console.log('stages:', Object.entries(r.timings.stages).map(([k,v])=>`${k}=${v.toFixed(0)}ms`).join(' '));
console.log('\n-- design dna --');
console.log('grid:', r.dna.grid.value, `(${(r.dna.grid.confidence*100).toFixed(0)}% ${r.dna.grid.measurementType})`);
console.log('edge margin:', r.dna.edgeMargin.value, `(${(r.dna.edgeMargin.confidence*100).toFixed(0)}%)`);
console.log('radii:', r.dna.radii.value.join(', ') || 'none');
console.log('font family:', r.dna.fontFamily.value ?? 'unknown (correctly not guessed)');
console.log('colors:');
for (const c of r.dna.colors.slice(0,7)) console.log(`   ${c.hex}  ${c.role.padEnd(14)} coverage ${(c.coverage*100).toFixed(1)}%`);
console.log('type scale:');
for (const t of r.dna.typography) console.log(`   ${t.name.padEnd(16)} ${t.fontSize}px/${t.fontWeight} lh ${t.lineHeight} ${t.color} (x${t.usage})`);
console.log('\n-- regions --');
const counts = {};
for (const region of r.regions) {
  const k = `${region.classification.componentType}/${region.classification.renderStrategy}`;
  counts[k] = (counts[k]||0)+1;
}
for (const [k,v] of Object.entries(counts).sort((a,b)=>b[1]-a[1])) console.log(`   ${k.padEnd(34)} ${v}`);
console.log('\nwarnings:', r.warnings.length ? r.warnings : 'none');

// Node tree summary
const { flatten, primaryScreen } = await import('@dae/shared');
const screen = primaryScreen(r.design);
const nodes = flatten(screen.root);
console.log(`\n-- IR tree: ${nodes.length} nodes --`);
function walk(n, depth) {
  const a = n.analysis;
  const t = a?.typography;
  console.log(`${'  '.repeat(depth)}${n.type.padEnd(17)} ${String(Math.round(n.frame.width)).padStart(4)}x${String(Math.round(n.frame.height)).padStart(4)} @${String(Math.round(n.frame.y)).padStart(4)}  ${a ? a.componentType.padEnd(12) : ''.padEnd(12)} ${a ? a.renderStrategy.padEnd(16) : ''.padEnd(16)} ${t ? `${t.fontSize}px/${t.fontWeight}` : ''} ${n.constraints.horizontal}`);
  for (const c of (n.children ?? [])) walk(c, depth + 1);
}
walk(screen.root, 0);
