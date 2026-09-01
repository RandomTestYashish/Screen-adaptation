import sharp from 'sharp';
const { reconstructRaster, planAdaptation } = await import('@dae/engine');
const { measured, PARSER_VERSION, primaryScreen } = await import('@dae/shared');
const { loadCatalog } = await import('@dae/device-catalog');

const catalog = loadCatalog();
const file = process.argv[2];
const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const image = { data: new Uint8ClampedArray(data), width: info.width, height: info.height };
const source = {
  id: 'src_t', projectId: 'p', kind: 'raster', name: 'test.png', mimeType: 'image/png', byteSize: 1,
  hash: 'a'.repeat(64), assetId: 'asset_1', width: info.width, height: info.height,
  pixelWidth: info.width, pixelHeight: info.height, exportScale: 1,
  exportScaleProvenance: measured('raster-pixels', 1), importedAt: new Date().toISOString(),
  parserVersion: PARSER_VERSION, immutable: true,
};

const r = reconstructRaster({ source, image });
const screen = primaryScreen(r.design);
console.log(`source ${info.width}x${info.height}  |  ${r.regions.length} regions\n`);

const CARD_LABEL = 'card/list rows fully visible in the first viewport';
console.log('device                        viewport    strategy            scale   doc height   ' + CARD_LABEL);
console.log('-'.repeat(132));

for (const id of ['apple-iphone-se-3','samsung-galaxy-s24','apple-iphone-13-mini','apple-iphone-16-pro','apple-iphone-16-pro-max','google-pixel-8-pro']) {
  const device = catalog.devices.find(d => d.id === id);
  const { plan, nodes } = planAdaptation({ design: r.design, screen, device, catalog, projectId: 'p' });
  const vh = plan.usableViewport.height;
  // rows whose bottom edge falls inside the first viewport
  const rows = nodes.filter(n => {
    const ir = r.regions.find(x => x.nodeId === n.nodeId);
    return ir && (ir.classification.componentType === 'LIST_ITEM' || ir.classification.componentType === 'CARD');
  });
  const visible = rows.filter(n => n.frame.y + n.frame.height <= vh).length;
  console.log(
    `${device.marketingName.padEnd(28)}  ${String(plan.targetViewport.width).padStart(3)}x${String(Math.round(vh)).padEnd(5)}  ${plan.strategy.padEnd(18)}  ${String(plan.scale).padEnd(6)}  ${String(Math.round(plan.targetScrollHeight)).padStart(6)}px      ${visible} of ${rows.length}`
  );
}

// Prove type is untouched
console.log('\ntypography across devices (must be identical - the viewport changed, not the design):');
for (const id of ['apple-iphone-se-3','apple-iphone-16-pro-max']) {
  const device = catalog.devices.find(d => d.id === id);
  const { plan } = planAdaptation({ design: r.design, screen, device, catalog, projectId: 'p' });
  const changed = plan.transforms.filter(t => 'fontSize' in t.after || 'fontWeight' in t.after);
  console.log(`  ${device.marketingName.padEnd(28)} type-altering transforms: ${changed.length}`);
}
