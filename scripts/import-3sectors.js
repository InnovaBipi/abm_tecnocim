const https = require('https');
const fs = require('fs');
const path = require('path');

const post = (urlPath, body, token) => new Promise((res, rej) => {
  const data = JSON.stringify(body);
  const opts = {
    hostname: 'abm.tecnociminnova.com', path: urlPath, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    rejectUnauthorized: false
  };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  const r = https.request(opts, resp => {
    let d = ''; resp.on('data', c => d += c);
    resp.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.substring(0, 200))); } });
  });
  r.on('error', rej); r.write(data); r.end();
});

const upload = (urlPath, filePath, token) => new Promise((res, rej) => {
  const file = fs.readFileSync(filePath);
  const boundary = '----FormBoundary' + Date.now();
  const fileName = path.basename(filePath);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: text/csv\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
  const opts = {
    hostname: 'abm.tecnociminnova.com', path: urlPath, method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length },
    rejectUnauthorized: false
  };
  const r = https.request(opts, resp => {
    let d = ''; resp.on('data', c => d += c);
    resp.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.substring(0, 200))); } });
  });
  r.on('error', rej); r.write(body); r.end();
});

(async () => {
  const login = await post('/api/auth/login', { email: 'alfons.marques@tecnocim.com', password: process.env.ABM_PASSWORD, tenant_slug: 'tecnocim' });
  if (!login.success) { console.log('Login failed:', login.error); return; }
  const token = login.data.token;
  fs.writeFileSync('/tmp/abm_token.txt', token);
  console.log('Login OK');

  const sectors = [
    { name: 'Plasticos', file: path.resolve(__dirname, 'output/prospects-plasticos-20260517.csv'), tag: 'batch-plasticos' },
    { name: 'Software Industrial', file: path.resolve(__dirname, 'output/prospects-software-20260517.csv'), tag: 'batch-software' },
    { name: 'Construccion', file: path.resolve(__dirname, 'output/prospects-construccion-20260517.csv'), tag: 'batch-construccion' }
  ];

  const results = [];
  for (const s of sectors) {
    console.log('\n=== ' + s.name + ' ===');

    const up = await upload('/api/imports/upload', s.file, token);
    console.log('Upload:', up.success ? 'OK' : 'FAIL', up.data?.import_id || up.error);
    if (!up.success) continue;

    const map = await post('/api/imports/' + up.data.import_id + '/map', {
      column_mapping: { email: 'email', first_name: 'first_name', company_name: 'company_name', domain: 'domain', industry: 'industry', city: 'city', region: 'region', country: 'country' },
      default_tags: ['deducciones-idi-2026', s.tag]
    }, token);
    console.log('Import:', map.data?.imported || 0, 'imported,', map.data?.skipped || 0, 'skipped');

    const camp = await post('/api/campaigns', {
      name: 'Deducciones I+D+i 2026 - ' + s.name,
      description: 'Prospecting ' + s.name.toLowerCase() + '. MX-verified. Claude 3-step personalized.',
      campaign_type: 'outbound', status: 'draft'
    }, token);
    const campId = camp.data?.id || camp.data?.campaign?.id || '';
    console.log('Campaign:', campId.substring(0, 8));
    results.push({ sector: s.name, imported: map.data?.imported || 0, campaignId: campId, tag: s.tag });
  }

  fs.writeFileSync('/tmp/import_results.json', JSON.stringify(results, null, 2));
  console.log('\nResults saved to /tmp/import_results.json');
  console.log(JSON.stringify(results, null, 2));
})().catch(e => console.error('Fatal:', e.message));
