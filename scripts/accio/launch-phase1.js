const fs = require('fs');
const path = require('path');

// Phase 1: Launch 10 slices in rapid sequence (async, no await between them)
const slices = [
  { provincia: 'Barcelona', comarca: 'Vallès Oriental', sector: 'metall' },
  { provincia: 'Barcelona', comarca: 'Vallès Oriental', sector: 'plastic' },
  { provincia: 'Barcelona', comarca: 'Osona', sector: 'metall' },
  { provincia: 'Barcelona', comarca: 'Bages', sector: 'metall' },
  { provincia: 'Barcelona', comarca: 'Berguedà', sector: 'metall' },
  { provincia: 'Girona', comarca: 'Gironès', sector: 'metall' },
  { provincia: 'Girona', comarca: 'La Selva', sector: 'plastic' },
  { provincia: 'Tarragona', comarca: 'Tarragonès', sector: 'metall' },
  { provincia: 'Lleida', comarca: 'Segrià', sector: 'metall' },
  { provincia: 'Barcelona', comarca: 'Vallès Occidental', sector: 'maquinaria' },
];

const seen = JSON.parse(fs.readFileSync('scripts/output/accio-engine/seen-domains.json', 'utf8'));

console.log(`Launching Phase 1: ${slices.length} slices`);
console.log(`Seed dedup: ${seen.length} domains\n`);

for (let i = 0; i < slices.length; i++) {
  const s = slices[i];
  const cmd = `node scripts/accio/accio-engine.wf.js --slice '${JSON.stringify(s)}' --seen '${JSON.stringify(seen)}' --target 50 --angles 8`;
  console.log(`[${i + 1}/${slices.length}] ${s.comarca} × ${s.sector}`);
  console.log(`  → node scripts/accio/accio-engine.wf.js ...`);
  // Fire in background (no await)
  const { spawn } = require('child_process');
  const ps = spawn('node', ['scripts/accio/accio-engine.wf.js', '--slice', JSON.stringify(s), '--seen', JSON.stringify(seen), '--target', '50', '--angles', '8'], {
    detached: true,
    stdio: 'ignore',
  });
  ps.unref();
  console.log(`  ✓ Launched (PID ${ps.pid})\n`);
}

console.log(`All ${slices.length} slices launched. Workflows running in background.`);
console.log(`Monitor with: node scripts/accio/monitor-phase1.js`);
