import { config } from '../config/env';

/**
 * Call Gemini API to generate content.
 */
export async function enrichWithGemini(prompt: string): Promise<string> {
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
        temperature: 0.7,
        maxOutputTokens: 2048,
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
