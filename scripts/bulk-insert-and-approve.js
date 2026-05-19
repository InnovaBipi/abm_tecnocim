const https = require('https');
const fs = require('fs');

const post = (path, body, token) => new Promise((res, rej) => {
  const data = JSON.stringify(body);
  const opts = {
    hostname: 'abm.tecnociminnova.com', path, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'Authorization': 'Bearer ' + token },
    rejectUnauthorized: false
  };
  const r = https.request(opts, resp => {
    let d = ''; resp.on('data', c => d += c);
    resp.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.substring(0, 200))); } });
  });
  r.on('error', rej); r.write(data); r.end();
});
const get = (path, token) => new Promise((res, rej) => {
  const opts = {
    hostname: 'abm.tecnociminnova.com', path, method: 'GET',
    headers: { 'Authorization': 'Bearer ' + token },
    rejectUnauthorized: false
  };
  const r = https.request(opts, resp => {
    let d = ''; resp.on('data', c => d += c);
    resp.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.substring(0, 200))); } });
  });
  r.on('error', rej); r.end();
});

(async () => {
  // Login
  const login = await post('/api/auth/login', { email: 'alfons.marques@tecnocim.com', password: 'Tecnocim2026!', tenant_slug: 'tecnocim' });
  if (!login.success) { console.log('Login failed:', login.error); return; }
  const token = login.data.token;
  console.log('Login OK');

  const allEmails = JSON.parse(fs.readFileSync('/tmp/all-3step-emails.json', 'utf8'));
  const importResults = JSON.parse(fs.readFileSync('/tmp/import_results.json', 'utf8'));

  // Map emails to campaigns by domain
  const domainToCampaign = {};
  const sectorDomains = {
    '9b28de57-335d-4c01-b53c-892918373272': ['crediplast.com','plasticalsl.com','tplastic.es','vicedomarti.com','rotolia.com','gbinyectados.com','plastire.es','abcrotomoldeo.com','isogom.com','garsanplast.com','industriastevi.es','plasticoscarrasco.com','arh.es','tecaplas.com','productos-salinas.com'],
    'c405c770-3f11-48b9-81eb-439fe4f1c7ad': ['spyro.es','ibernova.com','geprom.com','lisdatasolutions.com','robotnik.es','datisa.es','ahora.es','serimag.com','i-mas.com'],
    '3da76593-6fa4-4191-a767-2b8564a96d9b': ['hormipresa.com','grupohormifer.com','hermo.net','herarbo.com','iberianprecast.com','forpol.es','gilva.com','tecnyconta.es','prefabricatsplanas.com','modunova.com','bimmanagement.net','loyma.es','isolana.es']
  };
  for (const [campId, domains] of Object.entries(sectorDomains)) {
    for (const d of domains) domainToCampaign[d] = campId;
  }

  // Group emails by campaign
  const byCampaign = {};
  for (const e of allEmails) {
    const domain = e.email.split('@')[1];
    const campId = domainToCampaign[domain];
    if (!campId) { console.log('No campaign for domain:', domain); continue; }
    if (!byCampaign[campId]) byCampaign[campId] = [];
    byCampaign[campId].push({
      prospect_id: e.prospect_id,
      step_number: e.step_number,
      subject: e.subject,
      body_html: e.body_html,
      delay_days: e.delay_days
    });
  }

  // Bulk insert per campaign
  for (const [campId, emails] of Object.entries(byCampaign)) {
    const sector = importResults.find(r => r.campaignId === campId)?.sector || campId.substring(0, 8);
    console.log('\n=== ' + sector + ' ===');
    console.log('Inserting', emails.length, 'emails...');

    const r = await post('/api/campaigns/' + campId + '/bulk-insert-emails', { emails }, token);
    console.log('Result:', r.success ? 'OK' : 'FAIL', r.data?.inserted || r.error);
  }

  // Now approve all drafts in each campaign
  console.log('\n=== APPROVING ===');
  for (const [campId, _] of Object.entries(byCampaign)) {
    const sector = importResults.find(r => r.campaignId === campId)?.sector || campId.substring(0, 8);

    // Fetch draft emails
    const drafts = await get('/api/campaigns/' + campId + '/generated-emails?status=draft&limit=200', token);
    const draftEmails = drafts.data?.emails || [];
    const draftIds = draftEmails.map(e => e.id);

    if (draftIds.length === 0) {
      console.log(sector + ': no drafts to approve');
      continue;
    }

    console.log(sector + ': approving', draftIds.length, 'emails...');
    const approve = await post('/api/campaigns/' + campId + '/approve-emails', { email_ids: draftIds }, token);
    console.log('Result:', approve.success ? 'OK' : 'FAIL');
    if (approve.data) {
      console.log('  Scheduled:', approve.data.count, '| Distribution:', JSON.stringify(approve.data.distribution));
    }
    if (approve.error) console.log('  Error:', approve.error);
  }

  console.log('\nDone!');
})().catch(e => console.error('Fatal:', e.message));
