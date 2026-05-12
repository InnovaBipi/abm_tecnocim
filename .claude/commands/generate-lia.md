---
name: generate-lia
description: Generate a Legitimate Interest Assessment (LIA) document for a B2B prospecting campaign. Required by RGPD Art. 6.1.f before any outreach. Based on EDPB Guidelines 1/2024.
arguments:
  - name: campaign
    description: "Brief description of the campaign (e.g., 'AI training for HR directors in manufacturing SMEs in Catalonia')"
    required: true
  - name: sector
    description: "Target industry sector"
    required: true
  - name: region
    description: "Target region in Spain"
    required: true
user_facing: true
---

# Generate LIA (Legitimate Interest Assessment)

Generate a legally defensible Legitimate Interest Assessment document for a B2B prospecting campaign in Spain, following EDPB Guidelines 1/2024 and AEPD criteria.

## What is a LIA?

A Legitimate Interest Assessment (Prueba de Ponderacion) is a mandatory document under RGPD Art. 6.1.f that proves you have properly balanced your business interest against the data subject's rights before processing their data for direct marketing.

Without a documented LIA, legitimate interest CANNOT be defended before the AEPD.

## Document Structure

Generate a Markdown document with the following sections:

### 1. Datos del Responsable del Tratamiento
- Company: Read from tenant config or use "Tecnocim Innova SL"
- CIF: B02896231
- Address: Sant Cugat del Valles, Barcelona
- DPD/Contact: The tenant's reply_to email

### 2. Descripcion de la Actividad de Tratamiento
Based on the campaign description provided:
- What data will be processed (company name, generic email, sector, city)
- Purpose: B2B commercial prospecting for [campaign description]
- Categories of data subjects: professional contacts at manufacturing SMEs
- Volume: estimated number of contacts
- Duration: campaign period

### 3. Identificacion del Interes Legitimo (Part 1 of EDPB test)
Document the specific legitimate interest:
- What is the interest? (e.g., "Promote AI training services to manufacturing companies that could benefit from digital transformation")
- Is it lawful? (Not contrary to any Spanish law)
- Is it real and present? (Not hypothetical -- describe business need)
- Is it clearly articulated? (Specific, not vague)

### 4. Test de Necesidad (Part 2 of EDPB test)
- Why is email prospecting necessary to achieve this interest?
- Could the same interest be achieved through less intrusive means?
  - Advertising: possible but less targeted and more expensive for SME
  - Trade shows: relevant but limited geographic reach and frequency
  - Content marketing/inbound: being pursued in parallel, but insufficient alone for market penetration
  - Cold calling: more intrusive than email
- Conclusion: targeted email to generic corporate addresses is proportionate
- Data minimization: only processing company name, generic email, sector, city -- minimum necessary

### 5. Ponderacion de Intereses (Part 3 of EDPB test)

#### 5.1 Factores a favor del interes legitimo:
- Data is NOT personal (generic emails like info@, contacto@)
- Data obtained from public sources (company websites)
- Recipients are professional contacts in their business capacity
- Content is directly relevant to the recipient's professional function
- Low volume, targeted outreach (not mass marketing)
- Clear and immediate opt-out mechanism
- No special category data (Art. 9 RGPD) processed
- One-time initial contact, no follow-up after non-response or objection

#### 5.2 Factores en contra:
- No prior relationship exists
- LSSI Art. 21.1 technically requires consent for electronic commercial communications
- Recipients did not request the communication

#### 5.3 Salvaguardas implementadas:
- Generic email addresses only (no personal data under RGPD)
- Data sourced exclusively from public company websites
- One-click unsubscribe link in every email (LSSI Art. 21)
- List-Unsubscribe header (RFC 8058)
- Suppression list maintained and checked before every send
- Do-not-contact flag respected across all channels
- LSSI/RGPD disclaimer in every email footer
- Data controller identity clearly stated (legal name, CIF, address)
- Data source disclosed to recipients
- Rights exercise mechanism provided (email contact)
- Data retention policy: 12-month review, auto-archive inactive
- Warm-up sending schedule to protect domain reputation
- Prospect status tracking (prevent re-contacting rejected/unsubscribed)
- Lista Robinson check before sending (manual until API integrated)
- Autonomos/individual entrepreneurs excluded from outreach

#### 5.4 Conclusion:
State whether the legitimate interest prevails, citing the specific safeguards that tip the balance.

### 6. Base Legal Complementaria
- LOPDGDD Art. 19: Processing professional contact data of employees at legal entities
- Note: This article authorizes data PROCESSING, not email SENDING
- LSSI Art. 21: Addressed through low-volume, targeted, relevant outreach with immediate opt-out
- Risk level: [LOW/MEDIUM] based on all safeguards

### 7. Revision y Firma
- Date of assessment
- Next review date (annual)
- Signature line for data controller

## Output

Write the LIA document to: `scripts/output/lia-{sector}-{region}-{YYYYMMDD}.md`

After generating, inform the user:
- LIA file path
- Key risk areas identified
- Recommendation: have legal counsel review before first campaign send
- Reminder: check Lista Robinson manually at listarobinson.es before sending

## Legal References
- RGPD Art. 6.1.f (legitimate interest)
- RGPD Art. 14 (information when data not obtained from subject)
- RGPD Art. 21 (right to object to direct marketing)
- RGPD Art. 5.1.e (storage limitation)
- RGPD Art. 30 (records of processing activities)
- LOPDGDD Art. 19 (professional contact data)
- LSSI-CE Art. 20 (identification in commercial communications)
- LSSI-CE Art. 21 (prohibition of unsolicited communications)
- EDPB Guidelines 1/2024 (legitimate interest)
- CJEU Judgment C-621/22 (commercial interest as legitimate interest)
