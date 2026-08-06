import { config } from '../config/env';
import { resolveProspectLanguage, type ProspectLanguage } from './scheduling';

/** Tenant-specific context for AI email generation. */
export interface TenantAIContext {
  company_name: string;
  sender_name: string;
  company_description: string;
  industry_context: string;
  contact_email?: string;
  contact_phone?: string;
  entity_label?: string;        // e.g. "property", "programa"
  entity_label_plural?: string; // e.g. "properties", "programas"
  email_style?: string;         // tone/style instructions for AI
  key_differentiators?: string; // unique selling points to weave in
  default_language?: 'spanish' | 'catalan' | 'english'; // override language resolution
}

/** Default Tecnocim context (fallback when tenant config is missing). */
const DEFAULT_TENANT_CONTEXT: TenantAIContext = {
  company_name: 'Tecnocim Innova',
  sender_name: 'Alfons Marques',
  company_description: 'Tecnocim Innova - Consultora de innovación tecnológica. Especializados en gestión integral de bonificaciones fiscales I+D+i, transformación digital y desarrollo de software a medida.',
  industry_context: 'innovation consulting, R&D tax incentives, digital transformation',
  contact_email: 'alfons.marques@tecnocim.com',
  entity_label: 'servicio',
  entity_label_plural: 'servicios',
};

/**
 * Call Gemini API to generate content.
 */
export async function enrichWithGemini(prompt: string, options?: { temperature?: number; maxOutputTokens?: number }): Promise<string> {
  if (!config.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${config.GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
          ],
        },
      ],
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxOutputTokens ?? 2048,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data: any = await response.json();

  // Extract text from Gemini response
  const candidates = data.candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error('No response from Gemini API.');
  }

  const content = candidates[0].content;
  if (!content || !content.parts || content.parts.length === 0) {
    throw new Error('Empty content from Gemini API.');
  }

  return content.parts[0].text || '';
}

/**
 * Call Perplexity API for web-informed search/research.
 */
export async function searchWithPerplexity(queryText: string, systemPrompt?: string): Promise<string> {
  if (!config.PERPLEXITY_API_KEY) {
    throw new Error('PERPLEXITY_API_KEY is not configured.');
  }

  const url = 'https://api.perplexity.ai/chat/completions';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.PERPLEXITY_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'sonar',
      messages: [
        {
          role: 'system',
          content: systemPrompt || 'You are a research assistant specializing in business intelligence. Provide concise, factual information.',
        },
        {
          role: 'user',
          content: queryText,
        },
      ],
      max_tokens: 1024,
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Perplexity API error (${response.status}): ${errorText}`);
  }

  const data: any = await response.json();

  if (!data.choices || data.choices.length === 0) {
    throw new Error('No response from Perplexity API.');
  }

  return data.choices[0].message.content || '';
}

/**
 * Build the language instruction for the AI prompt based on resolved language.
 */
function getLanguageInstruction(language: ProspectLanguage): string {
  switch (language) {
    case 'catalan':
      return `MANDATORY: Write the ENTIRE email (subject line AND body) in CATALAN (Català).

CATALAN LANGUAGE RULES (strict):
- Use proper Catalan grammar, vocabulary, and spelling. Not a single word or phrase in Spanish.
- ACCENTS: Always use correct Catalan accents: à, è, é, í, ò, ó, ú, ï, ü, ç. Examples: innovació, inversió, producció, tecnològic, deducció, bonificació, salutació, projecte, experiència, fabricació, certificació, optimització.
- PUNCTUATION: Catalan does NOT use ¿ or ¡. NEVER write ¿ or ¡. Only use ? and ! at the end.
- GREETINGS: "Hola,", "Bon dia,". NEVER "Buenos días" or "Buenas tardes".
- CLOSINGS: "Salutacions,", "Atentament,", "Una salutació,". NEVER "Saludos", "Atentamente", "Un saludo".
- PRONOUNS: "us", "el vostre", "la vostra", "tindríeu", "voldríeu", "podríeu".
- FORBIDDEN SPANISH: NEVER use "también", "pero", "porque", "además", "puede", "interesaría", "gustaría", "equipo", "proyecto", "servicio", "resultados". Use Catalan: "també", "però", "perquè", "a més", "pot", "interessaria", "agradaria", "equip", "projecte", "servei", "resultats".
- CTAs: "Té sentit explorar-ho?", "Us interessaria valorar-ho?", "Podríem parlar-ne?"
NOTE: STYLE GUIDE, KEY DIFFERENTIATORS, and SENDER INFO below may be in Spanish — translate and adapt to Catalan.
The prospect is in Catalonia and expects communication in Catalan.`;
    case 'spanish':
      return `MANDATORY: Write the ENTIRE email (subject line AND body) in SPANISH (Español).
Use proper Castilian Spanish grammar. Use ¿ and ¡ where appropriate.
GREETINGS: "Hola,", "Buenos días,". CLOSINGS: "Saludos cordiales,", "Atentamente,".
ACCENTS: innovación, inversión, tecnología, producción, deducción.
NEVER use Catalan words (salutacions, atentament, també, però).
The prospect is in a Spanish-speaking region.`;
    case 'english':
      return `MANDATORY: Write the ENTIRE email (subject line AND body) in ENGLISH.
Use professional English. The prospect is international and English is the appropriate business language.
NOTE: STYLE GUIDE and DIFFERENTIATORS below may be in Spanish — translate and adapt to English.`;
  }
}

/**
 * Lightweight language consistency check.
 * Returns an array of warnings (empty = clean).
 * Does NOT block sending — just logs for monitoring.
 */
export function validateLanguageConsistency(
  text: string,
  expectedLanguage: ProspectLanguage
): string[] {
  const warnings: string[] = [];
  const lower = text.toLowerCase();

  if (expectedLanguage === 'catalan') {
    const spanishMarkers = [
      '¿', '¡',
      'saludos cordiales', 'atentamente', 'un saludo',
      'buenos días', 'buenas tardes',
      'también', 'además', 'mediante',
      'os interesaría', 'les gustaría',
      'estamos a su disposición',
    ];
    for (const marker of spanishMarkers) {
      if (lower.includes(marker)) {
        warnings.push(`Spanish marker "${marker}" found in Catalan email`);
      }
    }
  }

  if (expectedLanguage === 'spanish') {
    const catalanMarkers = [
      'salutacions', 'atentament', 'cordialment',
      'bon dia', 'bona tarda',
      'tindríeu', 'voldríeu', 'podríeu',
      'explorar-ho', 'valorar-ho', 'parlar-ne',
    ];
    for (const marker of catalanMarkers) {
      if (lower.includes(marker)) {
        warnings.push(`Catalan marker "${marker}" found in Spanish email`);
      }
    }
  }

  return warnings;
}

/**
 * Generate a personalized email using Gemini.
 * Accepts optional tenantContext for multi-tenant branding.
 */
export async function generateEmail(
  prospect: {
    first_name?: string;
    last_name?: string;
    title?: string;
    company_name?: string;
    industry?: string;
    city?: string;
    region?: string;
    country?: string;
  },
  campaign: {
    name: string;
    asset_type?: string;
    asset_location?: string;
    asset_price?: number;
    description?: string;
  },
  stepNumber: number,
  tenantContext?: TenantAIContext
): Promise<{ subject: string; body: string }> {
  const ctx = tenantContext || DEFAULT_TENANT_CONTEXT;
  const entityLabel = ctx.entity_label || 'property';

  const stepContext = stepNumber === 1
    ? 'This is the initial outreach email. Be warm and introductory.'
    : stepNumber === 2
    ? 'This is a follow-up email. Reference the previous message briefly and add new value.'
    : stepNumber === 3
    ? 'This is the third email in the sequence. Be more direct and include a clear call to action.'
    : `This is email #${stepNumber} in the sequence. Be concise and create urgency.`;

  const language = resolveProspectLanguage(prospect, ctx.default_language);
  const languageInstruction = getLanguageInstruction(language);
  const styleNote = language !== 'spanish' ? ' (NOTE: written in Spanish — adapt to target language)' : '';

  const prompt = `You are an email copywriter for ${ctx.company_name}.

SENDER INFO${styleNote}:
${ctx.company_description}

Write a professional, personalized B2B email for the following prospect and campaign:

PROSPECT:
- Name: ${prospect.first_name || ''} ${prospect.last_name || ''}
- Title: ${prospect.title || 'Unknown'}
- Company: ${prospect.company_name || 'Unknown'}
- Industry: ${prospect.industry || 'Unknown'}
- Location: ${prospect.city || 'Unknown'}, ${prospect.region || ''}, ${prospect.country || ''}

CAMPAIGN / ${entityLabel.toUpperCase()}:
- Campaign: ${campaign.name}
- Type: ${campaign.asset_type || `Premium ${entityLabel}`}
- Location: ${campaign.asset_location || 'Spain'}
- Price: ${campaign.asset_price ? `${campaign.asset_price.toLocaleString()}` : 'Upon request'}
- Details: ${campaign.description || ''}

SEQUENCE CONTEXT:
${stepContext}

LANGUAGE:
${languageInstruction}

INSTRUCTIONS:
- Write in a professional but approachable tone
- Personalize based on the prospect's role and company
- Focus on value proposition relevant to ${ctx.industry_context}
- Keep the email very concise (60-100 words MAX). Write like a busy executive.
- Subject line: maximum 5-7 words, under 40 characters. Short and specific.
- Do NOT use excessive exclamation marks or salesy language
- Sender is ${ctx.sender_name} from ${ctx.company_name}
${ctx.email_style ? `\nSTYLE${styleNote}:\n${ctx.email_style}` : ''}
${ctx.key_differentiators ? `\nKEY DIFFERENTIATORS${styleNote} (weave naturally into the email):\n${ctx.key_differentiators}` : ''}

Return your response in this exact JSON format:
{
  "subject": "The email subject line",
  "body": "The email body in plain text"
}`;

  const result = await enrichWithGemini(prompt);

  try {
    // Try to parse JSON from the response
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const emailResult = {
        subject: parsed.subject || `Opportunity from ${ctx.company_name}`,
        body: parsed.body || result,
      };
      const warnings = validateLanguageConsistency(`${emailResult.subject} ${emailResult.body}`, language);
      if (warnings.length > 0) {
        console.warn(`[AI] Language mixing detected (expected ${language}):`, warnings);
      }
      return emailResult;
    }
  } catch {
    // If JSON parsing fails, return the raw text
  }

  return {
    subject: `Opportunity from ${ctx.company_name}`,
    body: result,
  };
}

/**
 * Classify a reply email using Gemini.
 * Returns: 'positive' | 'negative' | 'out_of_office' | 'unsubscribe' | 'other'
 *
 * - positive: prospect shows interest, wants to talk, asks questions
 * - negative: explicit rejection ("not interested", "no thanks", "please stop")
 * - out_of_office: auto-reply, vacation, OOO
 * - unsubscribe: wants to be removed from mailing list
 * - other: unclear or unrelated
 */
export async function classifyReply(
  bodyText: string,
  subject: string
): Promise<string> {
  const prompt = `You are an email reply classifier for a B2B sales outreach platform.

Classify the following email reply into exactly ONE of these categories:
- positive: The person shows interest, wants more information, asks questions, or agrees to a meeting/call.
- negative: The person explicitly declines, says they're not interested, asks to stop emailing, or rejects the offer. Examples: "no gracias", "no estoy interesado", "no me interesa", "not interested", "please stop", "no thanks".
- out_of_office: Auto-reply, vacation notice, OOO message, or automatic response indicating the person is away.
- unsubscribe: The person explicitly asks to be removed from the mailing list or to stop receiving emails permanently. Examples: "darse de baja", "remove me", "unsubscribe".
- other: Cannot be clearly classified, or it's an unrelated response.

IMPORTANT: When in doubt between "negative" and "other", lean toward "negative" to protect the prospect from unwanted emails.

EMAIL SUBJECT: ${subject}

EMAIL BODY:
${bodyText.substring(0, 1500)}

Respond with ONLY the classification word (positive, negative, out_of_office, unsubscribe, or other). Nothing else.`;

  const result = await enrichWithGemini(prompt, { temperature: 0.1, maxOutputTokens: 20 });
  const classification = result.trim().toLowerCase().replace(/[^a-z_]/g, '');

  const validCategories = ['positive', 'negative', 'out_of_office', 'unsubscribe', 'other'];
  if (validCategories.includes(classification)) {
    return classification;
  }

  // Fuzzy match for partial responses
  if (classification.includes('positive')) return 'positive';
  if (classification.includes('negative')) return 'negative';
  if (classification.includes('out_of_office') || classification.includes('ooo')) return 'out_of_office';
  if (classification.includes('unsubscribe')) return 'unsubscribe';

  return 'other';
}

/**
 * Generate a full personalized email sequence using Gemini.
 * Uses enrichment data + campaign details to create hyper-personalized emails.
 * Accepts optional tenantContext for multi-tenant branding.
 */
export async function generatePersonalizedSequence(
  prospect: {
    first_name?: string;
    last_name?: string;
    title?: string;
    company_name?: string;
    industry?: string;
    city?: string;
    region?: string;
    country?: string;
    linkedin_url?: string;
  },
  enrichment: {
    ai_analysis?: {
      key_insights?: string[];
      company_description?: string;
      recommended_approach?: string;
      real_estate_relevance?: string;
      business_relevance?: string;
      investment_interest_score?: number;
      company_industry?: string;
      company_employee_count?: string;
      company_annual_revenue?: string;
      suggested_use_cases?: string[];
      pain_points?: string[];
    };
    perplexity_research?: string;
  } | null,
  campaign: {
    name: string;
    description?: string;
    asset_type?: string;
    asset_location?: string;
    asset_price?: number;
    asset_details?: Record<string, unknown>;
  },
  existingSteps: Array<{
    step_number: number;
    subject?: string;
    body_html?: string;
    delay_days?: number;
  }>,
  numSteps: number = 4,
  tenantContext?: TenantAIContext
): Promise<Array<{
  step_number: number;
  subject: string;
  body_html: string;
  delay_days: number;
}>> {
  const ctx = tenantContext || DEFAULT_TENANT_CONTEXT;
  const entityLabel = ctx.entity_label || 'property';
  const entityLabelPlural = ctx.entity_label_plural || 'properties';
  const ai = enrichment?.ai_analysis;
  const research = enrichment?.perplexity_research;

  // Build enrichment context
  let enrichmentContext = '';
  if (ai) {
    enrichmentContext = `
ENRICHMENT DATA (from AI research on this prospect):
- Company Description: ${ai.company_description || ''}
- Industry: ${ai.company_industry || ''}
- Employees: ${ai.company_employee_count || ''}
- Annual Revenue: ${ai.company_annual_revenue || ''}
- Business Relevance: ${ai.business_relevance || ai.real_estate_relevance || ''}
- Investment Interest Score: ${ai.investment_interest_score || ''}/10
- Recommended Approach: ${ai.recommended_approach || ''}
- Key Insights:
${(ai.key_insights || []).map((k: string, i: number) => `  ${i + 1}. ${k}`).join('\n')}
${(ai.suggested_use_cases && ai.suggested_use_cases.length > 0) ? `- Suggested Use Cases for This Company:\n${ai.suggested_use_cases.map((uc: string, i: number) => `  ${i + 1}. ${uc}`).join('\n')}` : ''}
${(ai.pain_points && ai.pain_points.length > 0) ? `- Pain Points / Challenges:\n${ai.pain_points.map((pp: string, i: number) => `  ${i + 1}. ${pp}`).join('\n')}` : ''}
`;
  }

  if (research) {
    enrichmentContext += `
DETAILED RESEARCH:
${research.substring(0, 2000)}
`;
  }

  // Fallback: if no enrichment data, provide minimum context
  if (!enrichmentContext) {
    enrichmentContext = `
AVAILABLE CONTEXT (no enrichment data available — base personalization on this):
- Company: ${prospect.company_name || ''}
- Industry: ${prospect.industry || ''}
- Location: ${prospect.city || ''}${prospect.region ? ', ' + prospect.region : ''}${prospect.country ? ', ' + prospect.country : ''}
- Typical pain points in this sector: derive from industry knowledge and market position
- Note: Perform personalization based on company name, industry classification, and geographic context.
`;
  }

  // Build existing steps context
  let existingStepsContext = '';
  if (existingSteps.length > 0) {
    existingStepsContext = `
EXISTING SEQUENCE TEMPLATE (use as structural reference, but personalize heavily):
${existingSteps.map(s => `  Step ${s.step_number} (day ${s.delay_days || 0}): Subject: "${s.subject || 'N/A'}"`).join('\n')}
`;
  }

  // Build asset details
  let assetDetailsStr = '';
  if (campaign.asset_details) {
    assetDetailsStr = `
${entityLabel.toUpperCase()} DETAILS (JSON):
${JSON.stringify(campaign.asset_details, null, 2)}
`;
  }

  const language = resolveProspectLanguage({
    region: prospect.region,
    country: prospect.country,
    city: prospect.city,
    title: prospect.title,
  }, ctx.default_language);
  const languageInstruction = getLanguageInstruction(language);
  const styleNote = language !== 'spanish' ? ' (NOTE: written in Spanish — adapt to target language)' : '';

  const contactInfo = [ctx.contact_email, ctx.contact_phone].filter(Boolean).join(' | ');

  const prompt = `You are a world-class B2B email strategist for ${ctx.company_name}.

SENDER INFO${styleNote}:
${ctx.company_description}${contactInfo ? ` Contacto: ${contactInfo}.` : ''}

Your task: Generate a ${numSteps}-email personalized outreach sequence that connects THIS SPECIFIC PROSPECT with THIS SPECIFIC ${entityLabel.toUpperCase()} in a compelling, non-generic way.

===== PROSPECT =====
- Name: ${prospect.first_name || ''} ${prospect.last_name || ''}
- Title: ${prospect.title || 'Unknown'}
- Company: ${prospect.company_name || 'Unknown'}
- Location: ${prospect.city || 'Unknown'}, ${prospect.region || ''}, ${prospect.country || 'Unknown'}
- LinkedIn: ${prospect.linkedin_url || 'N/A'}
${enrichmentContext}

===== ${entityLabel.toUpperCase()} / CAMPAIGN =====
- Campaign: ${campaign.name}
- Type: ${campaign.asset_type || `Premium ${entityLabel}`}
- Location: ${campaign.asset_location || 'Spain'}
- Price: ${campaign.asset_price ? new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(campaign.asset_price) : 'Upon request'}
- Description: ${campaign.description || ''}
${assetDetailsStr}
${existingStepsContext}

===== LANGUAGE =====
${languageInstruction}

===== CRITICAL INSTRUCTIONS =====
1. DO NOT write generic emails. Use the enrichment data to create SPECIFIC connections between the prospect's business and this ${entityLabel}. If enrichment data is limited, derive personalization from company name, industry, and location to create meaningful context.
2. Reference their company's actual activities, growth, market position, or strategy where relevant. If specific facts are unavailable, use industry-level insights and geographic context.
3. Adapt the angle to the prospect's industry and how it connects to ${ctx.industry_context}.
4. YOU MUST write the entire email (subject + body) in the language specified above. This is mandatory.
5. Tone: professional, concise, knowledgeable. No salesy language. No exclamation marks. Sound like a peer, not a salesperson.
6. Each email should have a distinct angle/hook, not just repeat the same pitch.
7. Email 1: Personal connection + propose a SPECIFIC USE CASE relevant to the prospect's company (based on what we know about their business from the enrichment data). Explain concretely how our service solves a real challenge they face.
8. Email 2: Value/data angle — dig deeper into a SECOND specific use case or pain point. Reference their actual industry dynamics, market position, or operational challenges.
9. Email 3: Social proof or urgency (mention relevant clients/cases, timing, exclusive access)
10. Email 4: Soft close (brief, respectful, open door)
11. BREVITY IS CRITICAL: Keep each email between 60-100 words MAX. Write like a busy executive — short paragraphs, no filler, get to the point fast. If you can say it in 60 words, do not use 100.
12. SUBJECT LINES: Maximum 5-7 words. Short, intriguing, specific. Examples: "IA aplicada a R+D a Cocunat", "Formació IA per a Sedatex", "Pregunta sobre el vostre equip". NEVER exceed 40 characters. No generic subjects.
13. Sender is ${ctx.sender_name} from ${ctx.company_name}.
14. IMPORTANT: If enrichment data includes "Suggested Use Cases" or "Pain Points", USE THEM. Propose concrete, specific use cases that demonstrate you understand the prospect's business. Do NOT be vague — the more specific and relevant the use case, the better.
15. NEVER use "Re:" as a fake reply prefix in subjects. Each subject must be original.
16. Do NOT include a "P.S." or postscript section.
17. HTML FORMAT: Start with greeting in its own paragraph: "<p>Hola [Name],</p>" followed by a separate "<p>" for the body. This ensures proper spacing between the greeting and the content. Do NOT combine the greeting with the first paragraph.
${ctx.email_style ? `\nSTYLE GUIDE${styleNote}:\n${ctx.email_style}` : ''}
${ctx.key_differentiators ? `\nKEY DIFFERENTIATORS${styleNote} (weave naturally, do not list them all in every email):\n${ctx.key_differentiators}` : ''}

Return ONLY a JSON array with exactly ${numSteps} objects. No markdown, no explanation, just the JSON:
[
  {
    "step_number": 1,
    "subject": "...",
    "body_html": "<p>...</p>",
    "delay_days": 0
  },
  {
    "step_number": 2,
    "subject": "...",
    "body_html": "<p>...</p>",
    "delay_days": 3
  }
]`;

  const result = await enrichWithGemini(prompt, { temperature: 0.8, maxOutputTokens: 8192 });

  try {
    // Extract JSON array from response
    const jsonMatch = result.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const steps = parsed.map((step: any, i: number) => ({
          step_number: step.step_number || i + 1,
          subject: step.subject || `Email ${i + 1}`,
          body_html: step.body_html || step.body || '',
          delay_days: step.delay_days ?? (i === 0 ? 0 : 3),
        }));
        for (const step of steps) {
          const warnings = validateLanguageConsistency(`${step.subject} ${step.body_html}`, language);
          if (warnings.length > 0) {
            console.warn(`[AI] Language mixing in step ${step.step_number} (expected ${language}):`, warnings);
          }
        }
        return steps;
      }
    }
  } catch (e) {
    console.error('Failed to parse generated sequence JSON:', e);
  }

  throw new Error('Gemini did not return a valid sequence. Please try again.');
}

/**
 * Branched sequence step definition returned by generateBranchedSequence.
 * Includes both email and condition nodes with graph navigation metadata.
 */
export interface BranchedStep {
  step_number: number;
  step_type: 'email' | 'condition';
  subject?: string;
  body_html?: string;
  delay_days: number;
  delay_hours: number;
  branch_label?: string;
  condition_config?: { type: string; threshold_hours?: number };
  // Wiring references: which step_numbers the condition routes to
  yes_target_step?: number;
  no_target_step?: number;
}

/**
 * Generate a branched email sequence with decision tree logic.
 *
 * Produces 5 email variants for different engagement paths:
 * - initial: First outreach (day 0)
 * - engaged: Follow-up for prospects who opened (day 2+)
 * - not_engaged: Re-engagement with new angle for non-openers (day 2+)
 * - direct_close: CTA for prospects who clicked (day 7+)
 * - soft_close: Final soft touch for non-clickers (day 10+)
 *
 * The AI generates email CONTENT only. The branching tree structure
 * (condition nodes, graph wiring) is assembled programmatically.
 */
export async function generateBranchedSequence(
  prospect: {
    first_name?: string;
    last_name?: string;
    title?: string;
    company_name?: string;
    industry?: string;
    city?: string;
    region?: string;
    country?: string;
    linkedin_url?: string;
  },
  enrichment: {
    ai_analysis?: {
      key_insights?: string[];
      company_description?: string;
      recommended_approach?: string;
      business_relevance?: string;
      real_estate_relevance?: string;
      investment_interest_score?: number;
      company_industry?: string;
      suggested_use_cases?: string[];
      pain_points?: string[];
    };
    perplexity_research?: string;
  } | null,
  campaign: {
    name: string;
    description?: string;
    asset_type?: string;
    asset_location?: string;
    asset_price?: number;
    asset_details?: Record<string, unknown>;
  },
  tenantContext?: TenantAIContext
): Promise<BranchedStep[]> {
  const ctx = tenantContext || DEFAULT_TENANT_CONTEXT;
  const ai = enrichment?.ai_analysis;
  const research = enrichment?.perplexity_research;

  let enrichmentContext = '';
  if (ai) {
    enrichmentContext = `
ENRICHMENT DATA:
- Company: ${ai.company_description || 'Unknown'}
- Industry: ${ai.company_industry || 'Unknown'}
- Business Relevance: ${ai.business_relevance || ai.real_estate_relevance || 'Unknown'}
- Recommended Approach: ${ai.recommended_approach || 'Unknown'}
${(ai.key_insights || []).length > 0 ? `- Key Insights:\n${ai.key_insights!.map((k, i) => `  ${i + 1}. ${k}`).join('\n')}` : ''}
${(ai.suggested_use_cases || []).length > 0 ? `- Use Cases:\n${ai.suggested_use_cases!.map((uc, i) => `  ${i + 1}. ${uc}`).join('\n')}` : ''}
${(ai.pain_points || []).length > 0 ? `- Pain Points:\n${ai.pain_points!.map((pp, i) => `  ${i + 1}. ${pp}`).join('\n')}` : ''}
`;
  }
  if (research) {
    enrichmentContext += `\nRESEARCH:\n${research.substring(0, 1500)}\n`;
  }

  const language = resolveProspectLanguage({
    region: prospect.region,
    country: prospect.country,
    city: prospect.city,
    title: prospect.title,
  }, ctx.default_language);
  const languageInstruction = getLanguageInstruction(language);
  const styleNote = language !== 'spanish' ? ' (NOTE: written in Spanish — adapt to target language)' : '';

  const prompt = `You are a world-class B2B email strategist for ${ctx.company_name}.

SENDER${styleNote}: ${ctx.sender_name} from ${ctx.company_name}.
${ctx.company_description}

PROSPECT:
- Name: ${prospect.first_name || ''} ${prospect.last_name || ''}
- Title: ${prospect.title || 'Unknown'}
- Company: ${prospect.company_name || 'Unknown'}
- Location: ${prospect.city || ''}, ${prospect.country || ''}
- LinkedIn: ${prospect.linkedin_url || 'N/A'}
${enrichmentContext}

CAMPAIGN: ${campaign.name}
${campaign.description || ''}

${languageInstruction}

TASK: Generate 5 DIFFERENT emails for a BRANCHED outreach sequence.
The sequence adapts based on prospect behavior (opens, clicks):

Email 1 "initial" (Day 0): First outreach. Personal connection + specific use case.
Email 2 "engaged" (Day 3): FOR PROSPECTS WHO OPENED EMAIL 1. They showed interest — deepen the value, reference a second use case or specific benefit.
Email 3 "not_engaged" (Day 3): FOR PROSPECTS WHO DID NOT OPEN. Completely different subject line and angle to re-engage.
Email 4 "direct_close" (Day 7): FOR ENGAGED PROSPECTS WHO CLICKED. Direct CTA — propose a meeting or call.
Email 5 "soft_close" (Day 10): FOR NON-ENGAGED. Final soft touch, leave the door open respectfully.

CRITICAL RULES:
1. Each email MUST have a UNIQUE angle and subject. No repetition.
2. BREVITY: 60-100 words MAX per email. Short paragraphs.
3. SUBJECTS: 5-7 words max, intriguing and specific. Under 40 characters.
4. Use enrichment data for SPECIFIC connections to the prospect's business.
5. Professional tone, no salesy language, no exclamation marks.
6. Write ALL emails in the language specified above.
7. NEVER use "Re:" prefix. Each subject must be original.
8. Email 3 (not_engaged) MUST have a completely different subject line approach than Email 1.
9. HTML FORMAT: Start with greeting in its own paragraph: "<p>Hola [Name],</p>" followed by a separate "<p>" for the body. Do NOT combine greeting with the first paragraph.
${ctx.email_style ? `\nSTYLE${styleNote}: ${ctx.email_style}` : ''}
${ctx.key_differentiators ? `\nDIFFERENTIATORS${styleNote}: ${ctx.key_differentiators}` : ''}

Return ONLY a JSON array with exactly 5 objects. No markdown, no explanation:
[
  { "branch_label": "initial", "subject": "...", "body_html": "<p>...</p>" },
  { "branch_label": "engaged", "subject": "...", "body_html": "<p>...</p>" },
  { "branch_label": "not_engaged", "subject": "...", "body_html": "<p>...</p>" },
  { "branch_label": "direct_close", "subject": "...", "body_html": "<p>...</p>" },
  { "branch_label": "soft_close", "subject": "...", "body_html": "<p>...</p>" }
]`;

  const result = await enrichWithGemini(prompt, { temperature: 0.8, maxOutputTokens: 8192 });

  let emails: Array<{ branch_label: string; subject: string; body_html: string }>;
  try {
    const jsonMatch = result.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array found');
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed) || parsed.length < 5) throw new Error('Expected 5 emails');
    emails = parsed;
  } catch (e) {
    console.error('Failed to parse branched sequence JSON:', e);
    throw new Error('Gemini did not return a valid branched sequence. Please try again.');
  }

  // Validate language consistency
  for (const email of emails) {
    const warnings = validateLanguageConsistency(`${email.subject} ${email.body_html}`, language);
    if (warnings.length > 0) {
      console.warn(`[AI] Language mixing in branch "${email.branch_label}" (expected ${language}):`, warnings);
    }
  }

  // Map branch_labels to emails
  const emailMap: Record<string, typeof emails[0]> = {};
  for (const email of emails) {
    emailMap[email.branch_label] = email;
  }

  const initial = emailMap['initial'] || emails[0];
  const engaged = emailMap['engaged'] || emails[1];
  const notEngaged = emailMap['not_engaged'] || emails[2];
  const directClose = emailMap['direct_close'] || emails[3];
  const softClose = emailMap['soft_close'] || emails[4];

  // Assemble the decision tree programmatically:
  // Step 1: Email (initial)         — day 0
  // Step 2: Condition (opened?)     — +2 days, 48h window
  // Step 3: Email (engaged)         — immediate after condition YES
  // Step 4: Email (not_engaged)     — immediate after condition NO
  // Step 5: Condition (clicked?)    — +4 days, 96h window
  // Step 6: Email (direct_close)    — immediate after condition YES
  // Step 7: Email (soft_close)      — immediate after condition NO
  return [
    {
      step_number: 1, step_type: 'email',
      subject: initial.subject, body_html: initial.body_html,
      delay_days: 0, delay_hours: 0, branch_label: 'initial',
    },
    {
      step_number: 2, step_type: 'condition',
      delay_days: 2, delay_hours: 0, branch_label: 'check_opened',
      condition_config: { type: 'opened', threshold_hours: 48 },
      yes_target_step: 3, no_target_step: 4,
    },
    {
      step_number: 3, step_type: 'email',
      subject: engaged.subject, body_html: engaged.body_html,
      delay_days: 0, delay_hours: 0, branch_label: 'engaged',
      yes_target_step: 5, // → next condition (skip step 4)
    },
    {
      step_number: 4, step_type: 'email',
      subject: notEngaged.subject, body_html: notEngaged.body_html,
      delay_days: 0, delay_hours: 0, branch_label: 'not_engaged',
      yes_target_step: 5, // → next condition (converge)
    },
    {
      step_number: 5, step_type: 'condition',
      delay_days: 4, delay_hours: 0, branch_label: 'check_clicked',
      condition_config: { type: 'clicked', threshold_hours: 96 },
      yes_target_step: 6, no_target_step: 7,
    },
    {
      step_number: 6, step_type: 'email',
      subject: directClose.subject, body_html: directClose.body_html,
      delay_days: 0, delay_hours: 0, branch_label: 'direct_close',
    },
    {
      step_number: 7, step_type: 'email',
      subject: softClose.subject, body_html: softClose.body_html,
      delay_days: 3, delay_hours: 0, branch_label: 'soft_close',
    },
  ];
}
