// Generate the partition queue (provincia × comarca × sector) for the ACCIÓ engine.
// Ranked by expected industrial yield so dense slices run first.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'output', 'accio-engine');

// comarca clusters with an industrial-density weight (higher = run first)
const COMARQUES = [
  { provincia: 'Barcelona', comarca: 'Valles Occidental', w: 10 },
  { provincia: 'Barcelona', comarca: 'Baix Llobregat', w: 10 },
  { provincia: 'Barcelona', comarca: 'Valles Oriental', w: 9 },
  { provincia: 'Barcelona', comarca: 'Barcelones', w: 8 },
  { provincia: 'Barcelona', comarca: 'Maresme', w: 8 },
  { provincia: 'Barcelona', comarca: 'Bages', w: 7 },
  { provincia: 'Barcelona', comarca: 'Osona', w: 7 },
  { provincia: 'Barcelona', comarca: 'Anoia', w: 6 },
  { provincia: 'Barcelona', comarca: 'Alt Penedes', w: 6 },
  { provincia: 'Barcelona', comarca: 'Garraf', w: 5 },
  { provincia: 'Girona', comarca: 'Girondes', w: 7 },
  { provincia: 'Girona', comarca: 'La Selva', w: 6 },
  { provincia: 'Girona', comarca: 'Garrotxa', w: 7 },
  { provincia: 'Girona', comarca: 'Alt Emporda', w: 5 },
  { provincia: 'Girona', comarca: 'Baix Emporda', w: 5 },
  { provincia: 'Tarragona', comarca: 'Tarragones', w: 7 },
  { provincia: 'Tarragona', comarca: 'Baix Camp', w: 6 },
  { provincia: 'Tarragona', comarca: 'Baix Penedes', w: 6 },
  { provincia: 'Tarragona', comarca: 'Alt Camp', w: 5 },
  { provincia: 'Tarragona', comarca: 'Ribera d\'Ebre', w: 5 },
  { provincia: 'Lleida', comarca: 'Segria', w: 6 },
  { provincia: 'Lleida', comarca: 'Urgell', w: 4 },
  { provincia: 'Lleida', comarca: 'Noguera', w: 4 },
];

// sectors (Catalan label, ACCIÓ industrial scope) with yield weight
const SECTORS = [
  { sector: 'metall', w: 10 },
  { sector: 'plastic', w: 9 },
  { sector: 'quimica', w: 8 },
  { sector: 'maquinaria', w: 9 },
  { sector: 'automocio', w: 8 },
  { sector: 'alimentacio', w: 8 },
  { sector: 'envasos', w: 7 },
  { sector: 'electronica', w: 7 },
  { sector: 'textil', w: 6 },
  { sector: 'construccio', w: 6 },
  { sector: 'fusta-mobiliari', w: 5 },
  { sector: 'paper-arts-grafiques', w: 5 },
  { sector: 'ceramica-materials', w: 5 },
  { sector: 'biotec-farma', w: 6 },
  { sector: 'energia-mediambient', w: 6 },
];

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const parts = [];
for (const c of COMARQUES) {
  for (const s of SECTORS) {
    parts.push({
      id: `${slug(c.comarca)}__${s.sector}`,
      provincia: c.provincia,
      comarca: c.comarca,
      sector: s.sector,
      rank: c.w * 10 + s.w, // dense comarca dominates, then sector
      status: 'pending',
      netted: 0,
      last_run: null,
    });
  }
}
parts.sort((a, b) => b.rank - a.rank);

fs.mkdirSync(ROOT, { recursive: true });
fs.writeFileSync(path.join(ROOT, 'partitions.json'), JSON.stringify(parts, null, 2));
console.log(`partitions.json: ${parts.length} slices (${COMARQUES.length} comarques × ${SECTORS.length} sectors)`);
console.log('top 5:', parts.slice(0, 5).map((p) => p.id).join(', '));
