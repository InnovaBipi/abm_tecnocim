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

/** Default CamiaCasa context (backwards compatibility). */
const DEFAULT_TENANT_CONTEXT: TenantAIContext = {
  company_name: 'CamiaCasa',
  sender_name: 'Alfons Marques',
  company_description: 'Agencia inmobiliaria profesional en Sant Vicenç dels Horts (Baix Llobregat, Catalunya). +15 años de experiencia, +64 municipios. Especializados en compra-venta, gestión de patrimonio, inversión inmobiliaria, personal shopping inmobiliario y valoraciones profesionales.',
  industry_context: 'real estate investment',
  contact_email: 'alfons.marques@camiacasa.cat',
  contact_phone: '+34 614 378 560',
  entity_label: 'property',
  entity_label_plural: 'properties',
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
Use natural Catalan: "Hola", "Bon dia", "Salutacions", "Atentament". Use proper Catalan grammar and vocabulary.
The prospect is in Catalonia and expects communication in Catalan.`;
    case 'spanish':
      return `MANDATORY: Write the ENTIRE email (subject line AND body) in SPANISH (Español).
Use natural Spanish: "Hola", "Buenos días", "Saludos cordiales", "Atentamente". Use proper Spanish grammar.
The prospect is in a Spanish-speaking region.`;
    case 'english':
      return `MANDATORY: Write the ENTIRE email (subject line AND body) in ENGLISH.
Use professional English. The prospect is international and English is the appropriate business language.`;
  }
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

  const prompt = `You are an email copywriter for ${ctx.company_name}.

SENDER INFO:
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
- Keep the email concise (150-250 words)
- Do NOT use excessive exclamation marks or salesy language
- Sender is ${ctx.sender_name} from ${ctx.company_name}
${ctx.email_style ? `\nSTYLE:\n${ctx.email_style}` : ''}
${ctx.key_differentiators ? `\nKEY DIFFERENTIATORS (weave naturally into the email):\n${ctx.key_differentiators}` : ''}

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
      return {
        subject: parsed.subject || `Opportunity from ${ctx.company_name}`,
        body: parsed.body || result,
      };
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
- Company Description: ${ai.company_description || 'Unknown'}
- Industry: ${ai.company_industry || 'Unknown'}
- Employees: ${ai.company_employee_count || 'Unknown'}
- Annual Revenue: ${ai.company_annual_revenue || 'Unknown'}
- Business Relevance: ${ai.business_relevance || ai.real_estate_relevance || 'Unknown'}
- Investment Interest Score: ${ai.investment_interest_score || 'Unknown'}/10
- Recommended Approach: ${ai.recommended_approach || 'Unknown'}
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

  const contactInfo = [ctx.contact_email, ctx.contact_phone].filter(Boolean).join(' | ');

  const prompt = `You are a world-class B2B email strategist for ${ctx.company_name}.

SENDER INFO:
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
1. DO NOT write generic emails. Use the enrichment data to create SPECIFIC connections between the prospect's business and this ${entityLabel}.
2. Reference their company's actual activities, growth, market position, or strategy where relevant.
3. Adapt the angle to the prospect's industry and how it connects to ${ctx.industry_context}.
4. YOU MUST write the entire email (subject + body) in the language specified above. This is mandatory.
5. Tone: professional, concise, knowledgeable. No salesy language. No exclamation marks. Sound like a peer, not a salesperson.
6. Each email should have a distinct angle/hook, not just repeat the same pitch.
7. Email 1: Personal connection + propose a SPECIFIC USE CASE relevant to the prospect's company (based on what we know about their business from the enrichment data). Explain concretely how our service solves a real challenge they face.
8. Email 2: Value/data angle — dig deeper into a SECOND specific use case or pain point. Reference their actual industry dynamics, market position, or operational challenges.
9. Email 3: Social proof or urgency (mention relevant clients/cases, timing, exclusive access)
10. Email 4: Soft close (brief, respectful, open door)
11. Keep each email 100-200 words. Shorter is better.
12. Sender is ${ctx.sender_name} from ${ctx.company_name}.
13. IMPORTANT: If enrichment data includes "Suggested Use Cases" or "Pain Points", USE THEM. Propose concrete, specific use cases that demonstrate you understand the prospect's business. Do NOT be vague — the more specific and relevant the use case, the better.
${ctx.email_style ? `\nSTYLE GUIDE:\n${ctx.email_style}` : ''}
${ctx.key_differentiators ? `\nKEY DIFFERENTIATORS (weave naturally, do not list them all in every email):\n${ctx.key_differentiators}` : ''}

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
        return parsed.map((step: any, i: number) => ({
          step_number: step.step_number || i + 1,
          subject: step.subject || `Email ${i + 1}`,
          body_html: step.body_html || step.body || '',
          delay_days: step.delay_days ?? (i === 0 ? 0 : 3),
        }));
      }
    }
  } catch (e) {
    console.error('Failed to parse generated sequence JSON:', e);
  }

  throw new Error('Gemini did not return a valid sequence. Please try again.');
}
