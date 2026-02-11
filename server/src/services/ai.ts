import { config } from '../config/env';

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

  const data = await response.json();

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
export async function searchWithPerplexity(queryText: string): Promise<string> {
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
          content: 'You are a research assistant specializing in real estate and business intelligence. Provide concise, factual information.',
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

  const data = await response.json();

  if (!data.choices || data.choices.length === 0) {
    throw new Error('No response from Perplexity API.');
  }

  return data.choices[0].message.content || '';
}

/**
 * Generate a personalized email using Gemini.
 */
export async function generateEmail(
  prospect: {
    first_name?: string;
    last_name?: string;
    title?: string;
    company_name?: string;
    industry?: string;
    city?: string;
  },
  campaign: {
    name: string;
    asset_type?: string;
    asset_location?: string;
    asset_price?: number;
    description?: string;
  },
  stepNumber: number
): Promise<{ subject: string; body: string }> {
  const stepContext = stepNumber === 1
    ? 'This is the initial outreach email. Be warm and introductory.'
    : stepNumber === 2
    ? 'This is a follow-up email. Reference the previous message briefly and add new value.'
    : stepNumber === 3
    ? 'This is the third email in the sequence. Be more direct and include a clear call to action.'
    : `This is email #${stepNumber} in the sequence. Be concise and create urgency.`;

  const prompt = `You are an email copywriter for CamiaCasa, a premium real estate company in Spain (Catalonia).

Write a professional, personalized B2B email for the following prospect and campaign:

PROSPECT:
- Name: ${prospect.first_name || ''} ${prospect.last_name || ''}
- Title: ${prospect.title || 'Unknown'}
- Company: ${prospect.company_name || 'Unknown'}
- Industry: ${prospect.industry || 'Unknown'}
- Location: ${prospect.city || 'Unknown'}

CAMPAIGN / REAL ESTATE ASSET:
- Campaign: ${campaign.name}
- Asset Type: ${campaign.asset_type || 'Premium property'}
- Location: ${campaign.asset_location || 'Catalonia, Spain'}
- Price: ${campaign.asset_price ? `${campaign.asset_price.toLocaleString()}` : 'Upon request'}
- Details: ${campaign.description || ''}

SEQUENCE CONTEXT:
${stepContext}

INSTRUCTIONS:
- Write in a professional but approachable tone
- Personalize based on the prospect's role and company
- Focus on value proposition and investment opportunity
- Keep the email concise (150-250 words)
- The email can be in English or Spanish based on the prospect's location
- Do NOT use excessive exclamation marks or salesy language

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
        subject: parsed.subject || 'Investment Opportunity from CamiaCasa',
        body: parsed.body || result,
      };
    }
  } catch {
    // If JSON parsing fails, return the raw text
  }

  return {
    subject: 'Investment Opportunity from CamiaCasa',
    body: result,
  };
}

/**
 * Generate a full personalized email sequence using Gemini.
 * Uses enrichment data + campaign details to create hyper-personalized emails.
 */
export async function generatePersonalizedSequence(
  prospect: {
    first_name?: string;
    last_name?: string;
    title?: string;
    company_name?: string;
    industry?: string;
    city?: string;
    country?: string;
    linkedin_url?: string;
  },
  enrichment: {
    ai_analysis?: {
      key_insights?: string[];
      company_description?: string;
      recommended_approach?: string;
      real_estate_relevance?: string;
      investment_interest_score?: number;
      company_industry?: string;
      company_employee_count?: string;
      company_annual_revenue?: string;
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
  numSteps: number = 4
): Promise<Array<{
  step_number: number;
  subject: string;
  body_html: string;
  delay_days: number;
}>> {
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
- Real Estate Relevance: ${ai.real_estate_relevance || 'Unknown'}
- Investment Interest Score: ${ai.investment_interest_score || 'Unknown'}/10
- Recommended Approach: ${ai.recommended_approach || 'Unknown'}
- Key Insights:
${(ai.key_insights || []).map((k, i) => `  ${i + 1}. ${k}`).join('\n')}
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
ASSET DETAILS (JSON):
${JSON.stringify(campaign.asset_details, null, 2)}
`;
  }

  const prompt = `You are a world-class B2B email strategist for CamiaCasa.

SENDER INFO:
CamiaCasa - Agencia inmobiliaria profesional en Sant Vicenç dels Horts (Baix Llobregat, Catalunya). +15 años de experiencia, +64 municipios. Especializados en compra-venta, gestión de patrimonio, inversión inmobiliaria, personal shopping inmobiliario y valoraciones profesionales. Misión: democratizar herramientas profesionales inmobiliarias para particulares. Contacto: alfons.marques@camiacasa.cat | +34 614 378 560.

Your task: Generate a ${numSteps}-email personalized outreach sequence that connects THIS SPECIFIC PROSPECT with THIS SPECIFIC PROPERTY in a compelling, non-generic way.

===== PROSPECT =====
- Name: ${prospect.first_name || ''} ${prospect.last_name || ''}
- Title: ${prospect.title || 'Unknown'}
- Company: ${prospect.company_name || 'Unknown'}
- Location: ${prospect.city || 'Unknown'}, ${prospect.country || 'Unknown'}
- LinkedIn: ${prospect.linkedin_url || 'N/A'}
${enrichmentContext}

===== PROPERTY / CAMPAIGN =====
- Campaign: ${campaign.name}
- Asset Type: ${campaign.asset_type || 'Premium property'}
- Location: ${campaign.asset_location || 'Spain'}
- Price: ${campaign.asset_price ? new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(campaign.asset_price) : 'Upon request'}
- Description: ${campaign.description || ''}
${assetDetailsStr}
${existingStepsContext}

===== CRITICAL INSTRUCTIONS =====
1. DO NOT write generic "investment opportunity" emails. Use the enrichment data to create SPECIFIC connections between the prospect's business and this property.
2. Reference their company's actual activities, growth, market position, or strategy where relevant.
3. If the prospect's company is in hospitality/hotels, connect to their expansion pipeline. If in investment, connect to portfolio fit. If in real estate, connect to their market focus.
4. Write in the prospect's likely language (English if they're international, Spanish/Catalan if from Spain).
5. Tone: professional, concise, knowledgeable. No salesy language. No exclamation marks. Sound like a peer, not a salesperson.
6. Each email should have a distinct angle/hook, not just repeat the same pitch.
7. Email 1: Personal connection + property introduction (why THIS property for THEIR business)
8. Email 2: Value/data angle (market data, financial projections, strategic fit)
9. Email 3: Social proof or urgency (other interest, timing, exclusive access)
10. Email 4: Soft close (brief, respectful, open door)
11. Keep each email 100-200 words. Shorter is better.
12. Sender is Alfons Marques from CamiaCasa.

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
