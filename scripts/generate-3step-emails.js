// Generate 3-step personalized emails for 31 prospects
// Each prospect gets step 1 (day 0), step 2 (day 3), step 3 (day 7)
const fs = require('fs');

const prospectMap = JSON.parse(fs.readFileSync('/tmp/prospect_map.json', 'utf8'));
const importResults = JSON.parse(fs.readFileSync('/tmp/import_results.json', 'utf8'));

const isCatalan = (region) => /catalunya|cataluña/i.test(region || '');

// Company-specific data for personalization
const companyData = {
  // PLASTICOS
  'crediplast.com': { fact: 'más de 30 años en inyección de plástico técnico', subsector: 'inyección técnica' },
  'plasticalsl.com': { fact: 'inyección y termoconformado en Aragón', subsector: 'transformación plástica' },
  'tplastic.es': { fact: '18 inyectoras y especialización en sobreinyección', subsector: 'inyección multimaterial' },
  'vicedomarti.com': { fact: 'inyección y soplado de plástico en Ibi, Alicante', subsector: 'soplado industrial' },
  'rotolia.com': { fact: 'fabricación de plásticos a medida por rotomoldeo', subsector: 'rotomoldeo' },
  'gbinyectados.com': { fact: 'inyección de plástico técnico en el clúster de Ibi', subsector: 'inyección técnica' },
  'plastire.es': { fact: 'extrusión de plásticos con más de 40 años', subsector: 'extrusión' },
  'abcrotomoldeo.com': { fact: 'rotomoldeo industrial con piezas de gran tamaño', subsector: 'rotomoldeo industrial' },
  'isogom.com': { fact: 'sistemas de caucho y elastómeros técnicos', subsector: 'elastómeros tècnics' },
  'garsanplast.com': { fact: 'inyección de plástico en Andalucía', subsector: 'inyección' },
  'industriastevi.es': { fact: 'inyección de plásticos industriales en Valencia', subsector: 'inyección industrial' },
  'plasticoscarrasco.com': { fact: 'inyección para automoción y electrodomésticos', subsector: 'inyección automoción' },
  'arh.es': { fact: 'fabricación de artículos de caucho técnico desde hace décadas', subsector: 'caucho técnico' },
  'tecaplas.com': { fact: 'fabricación de productos de caucho en País Vasco', subsector: 'caucho industrial' },
  'productos-salinas.com': { fact: 'cauchos y poliuretanos técnicos del grupo Klinger', subsector: 'poliuretano técnico' },
  // SOFTWARE
  'spyro.es': { fact: 'ERP/MES industrial con más de 35 años digitalizando fábricas', subsector: 'ERP industrial' },
  'ibernova.com': { fact: 'MES para la PYME industrial, enfoque en datos operativos', subsector: 'MES/datos' },
  'geprom.com': { fact: 'SCADA, MES i automatització industrial, partner de Siemens', subsector: 'SCADA/MES' },
  'lisdatasolutions.com': { fact: 'AI y Business Intelligence para industria y logística', subsector: 'AI/BI industrial' },
  'robotnik.es': { fact: 'robótica móvil autónoma con presencia en la Estación Espacial Internacional', subsector: 'robótica móvil' },
  'datisa.es': { fact: 'ERP para fabricación con más de 40 años de experiencia', subsector: 'ERP fabricación' },
  'ahora.es': { fact: 'ERP/MES para fabricación con 30 años en el mercado', subsector: 'ERP/MES' },
  'serimag.com': { fact: 'visió artificial i IA per automatització de processos industrials', subsector: 'visió artificial' },
  'i-mas.com': { fact: 'automatització industrial, visió artificial i enginyeria de producte', subsector: 'automatització' },
  // CONSTRUCCION
  'hormipresa.com': { fact: "pionera en prefabricats de formigó amb més de 50 anys d'experiència", subsector: 'prefabricats formigó' },
  'grupohormifer.com': { fact: 'viviendas modulares de hormigón en Valencia', subsector: 'modular hormigón' },
  'hermo.net': { fact: 'prefabricados de hormigón y viviendas en Castellón', subsector: 'prefabricados' },
  'herarbo.com': { fact: 'prefabricados con subvenciones de innovación de la Generalitat', subsector: 'prefabricados' },
  'iberianprecast.com': { fact: 'prefabricados con reconocimiento CEPYME500 (top-500 PYMES)', subsector: 'prefabricados' },
  'forpol.es': { fact: 'prefabricados de hormigón y estructuras metálicas', subsector: 'estructuras' },
  'gilva.com': { fact: 'prefabricados de hormigón para obra civil e industrial', subsector: 'prefabricados' },
  'tecnyconta.es': { fact: 'estructuras de hormigón prefabricado en Zaragoza', subsector: 'prefabricados Aragón' },
  'prefabricatsplanas.com': { fact: 'prefabricats de formigó a Girona, creixement sectorial 2025', subsector: 'prefabricats' },
  'modunova.com': { fact: 'casas prefabricadas de hormigón en Sevilla', subsector: 'modular' },
  'bimmanagement.net': { fact: 'enginyeria BIM i estructures metàl·liques a Barcelona', subsector: 'BIM/estructures' },
  'loyma.es': { fact: 'estructuras metálicas, cubiertas y cerramientos', subsector: 'metálicas' },
  'isolana.es': { fact: 'aislamiento técnico industrial con décadas de experiencia', subsector: 'aislamiento técnico' },
};

// Deduction phrasings to vary
const phrasings = [
  'deducciones fiscales de I+D+i del 25-42%',
  'incentivos fiscales por innovación de hasta el 42%',
  'bonificaciones fiscales en el Impuesto de Sociedades',
  'retorno fiscal del 25% al 42% sobre inversión en I+D',
  'deducciones del Art. 35 por innovación tecnológica',
  'recuperar entre el 25% y el 42% de la inversión en I+D+i',
  'incentivos del Art. 35 de la Ley del Impuesto de Sociedades',
  'bonificaciones por I+D+i que pueden suponer hasta el 42%'
];
const catalanPhrasings = [
  'deduccions fiscals d\'I+D+i del 25-42%',
  'incentius fiscals per innovació de fins al 42%',
  'bonificacions fiscals en l\'Impost de Societats',
  'retorn fiscal del 25% al 42% sobre inversió en I+D',
  'deduccions de l\'Art. 35 per innovació tecnològica'
];

// Step 2 CTAs
const step2CTAs_es = [
  '¿Le gustaría que le envíe un análisis preliminar gratuito?',
  '¿Tiene sentido que revisemos juntos el potencial de deducción?',
  '¿Le interesaría conocer el cálculo estimado para su empresa?',
];
const step2CTAs_ca = [
  'Voldríeu que us enviés una anàlisi preliminar gratuïta?',
  'Té sentit que revisem junts el potencial de deducció?',
];

// Step 3 CTAs
const step3CTAs_es = [
  'Si no es buen momento, sin problema. Quedo a disposición.',
  'Entiendo si no es prioritario ahora. El análisis queda disponible cuando lo necesite.',
  'Sin compromiso. Si en algún momento le interesa, aquí estamos.',
];
const step3CTAs_ca = [
  'Si no és bon moment, cap problema. Quedo a disposició.',
  'Entenc si no és prioritari ara. Quedo a la seva disposició.',
];

let phrasingIdx = 0;
const allEmails = [];

for (const [email, data] of Object.entries(prospectMap)) {
  const domain = email.split('@')[1];
  const cd = companyData[domain];
  if (!cd) continue;

  const catalan = isCatalan(data.region);
  const p = catalan ? catalanPhrasings[phrasingIdx % catalanPhrasings.length] : phrasings[phrasingIdx % phrasings.length];
  const p2 = catalan ? catalanPhrasings[(phrasingIdx + 1) % catalanPhrasings.length] : phrasings[(phrasingIdx + 1) % phrasings.length];
  const company = data.company || '';
  const shortCompany = company.replace(/\s*(S\.L\.U?\.|S\.A\.U?\.|S\.L\.L?\.)$/i, '').trim();

  // Step 1: Connection + use case
  let subj1, body1;
  if (catalan) {
    subj1 = `${shortCompany} i deduccions I+D+i`;
    body1 = `<p>Hola,</p><p>${company} destaca per ${cd.fact}. Aquest tipus d'activitat tècnica sovint qualifica per a ${p}, però moltes empreses del sector no els aprofiten.</p><p>A Tecnocim Innova ajudem empreses com la vostra a identificar i recuperar aquestes deduccions sense canviar res en la vostra operativa.</p><p>Té sentit explorar-ho?</p><p>Alfons Marquès<br>Tecnocim Innova</p>`;
  } else {
    subj1 = `${shortCompany} e incentivos I+D+i`;
    body1 = `<p>Hola,</p><p>${company} destaca por ${cd.fact}. Este tipo de actividad técnica suele cualificar para ${p}, pero muchas empresas del sector no las aprovechan.</p><p>En Tecnocim Innova ayudamos a empresas como la suya a identificar y recuperar estas deducciones sin cambiar nada en su operativa.</p><p>¿Tiene sentido explorarlo?</p><p>Alfons Marquès<br>Tecnocim Innova</p>`;
  }

  // Step 2: Value/data angle
  let subj2, body2;
  const cta2 = catalan ? step2CTAs_ca[phrasingIdx % step2CTAs_ca.length] : step2CTAs_es[phrasingIdx % step2CTAs_es.length];
  if (catalan) {
    subj2 = `Recuperació fiscal en ${cd.subsector}`;
    body2 = `<p>Hola,</p><p>Complementant el meu missatge anterior: empreses del sector de ${cd.subsector} a Espanya recuperen de mitjana entre 50.000 i 200.000 euros anuals gràcies a les ${p2}.</p><p>El nostre sistema BIPI identifica automàticament quines activitats qualifiquen, sense paperassa addicional per al vostre equip.</p><p>${cta2}</p><p>Alfons Marquès<br>Tecnocim Innova</p>`;
  } else {
    subj2 = `Recuperación fiscal en ${cd.subsector}`;
    body2 = `<p>Hola,</p><p>Complementando mi mensaje anterior: empresas del sector de ${cd.subsector} en España recuperan de media entre 50.000 y 200.000 euros anuales gracias a las ${p2}.</p><p>Nuestro sistema BIPI identifica automáticamente qué actividades cualifican, sin papeleo adicional para su equipo.</p><p>${cta2}</p><p>Alfons Marquès<br>Tecnocim Innova</p>`;
  }

  // Step 3: Soft close
  let subj3, body3;
  const cta3 = catalan ? step3CTAs_ca[phrasingIdx % step3CTAs_ca.length] : step3CTAs_es[phrasingIdx % step3CTAs_es.length];
  if (catalan) {
    subj3 = `Últim missatge, ${shortCompany}`;
    body3 = `<p>Hola,</p><p>Us vaig contactar fa uns dies sobre les deduccions fiscals d'I+D+i aplicables a ${cd.subsector}. Entenc que potser no és prioritari ara.</p><p>${cta3}</p><p>Alfons Marquès<br>Tecnocim Innova</p>`;
  } else {
    subj3 = `Último mensaje, ${shortCompany}`;
    body3 = `<p>Hola,</p><p>Les contacté hace unos días sobre las deducciones fiscales de I+D+i aplicables a ${cd.subsector}. Entiendo que quizá no sea prioritario ahora.</p><p>${cta3}</p><p>Alfons Marquès<br>Tecnocim Innova</p>`;
  }

  // Trim subjects to 40 chars max
  if (subj1.length > 40) subj1 = subj1.substring(0, 37) + '...';
  if (subj2.length > 40) subj2 = subj2.substring(0, 37) + '...';
  if (subj3.length > 30) subj3 = subj3.substring(0, 27) + '...';

  allEmails.push(
    { prospect_id: data.id, email, company: data.company, step_number: 1, delay_days: 0, subject: subj1, body_html: body1, language: catalan ? 'catalan' : 'spanish' },
    { prospect_id: data.id, email, company: data.company, step_number: 2, delay_days: 3, subject: subj2, body_html: body2, language: catalan ? 'catalan' : 'spanish' },
    { prospect_id: data.id, email, company: data.company, step_number: 3, delay_days: 7, subject: subj3, body_html: body3, language: catalan ? 'catalan' : 'spanish' }
  );

  phrasingIdx++;
}

// Validate: no Unknown, no campaign names
let issues = 0;
allEmails.forEach(e => {
  const all = e.subject + ' ' + e.body_html;
  if (/unknown/i.test(all)) { console.error('FAIL: Unknown in', e.email, 'step', e.step_number); issues++; }
  if (/batch/i.test(all)) { console.error('FAIL: Batch ref in', e.email, 'step', e.step_number); issues++; }
  if (/Deducciones I\+D\+i 2026/i.test(all)) { console.error('FAIL: Campaign name in', e.email); issues++; }
});

console.log('Total emails generated:', allEmails.length);
console.log('QA issues:', issues);
console.log('By language:', allEmails.filter(e => e.language === 'catalan').length, 'catalan,', allEmails.filter(e => e.language === 'spanish').length, 'spanish');
console.log('By step:', [1,2,3].map(s => 'step ' + s + ': ' + allEmails.filter(e => e.step_number === s).length).join(', '));

fs.writeFileSync('/tmp/all-3step-emails.json', JSON.stringify(allEmails, null, 2));
console.log('\nSaved to /tmp/all-3step-emails.json');

// Sample output
console.log('\n=== SAMPLE (first company, 3 steps) ===');
allEmails.slice(0, 3).forEach(e => {
  const text = e.body_html.replace(/<[^>]*>/g, ' ').trim();
  const words = text.split(/\s+/).length;
  console.log(`Step ${e.step_number} [${e.language}] subj:${e.subject.length}ch words:${words}`);
  console.log(`  Subject: ${e.subject}`);
  console.log(`  Body: ${text.substring(0, 150)}...`);
});
