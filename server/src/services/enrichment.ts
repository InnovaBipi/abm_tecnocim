import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import { searchWithPerplexity, enrichWithGemini } from './ai';
import { scrapeCompanyWebsite } from './scraper';
import { calculateScore } from './scoring';
import { getTenantConfig } from '../middleware/tenant';

/**
 * Orchestrate full enrichment of a prospect:
 * 1. Search company info with Perplexity
 * 2. Scrape company website with Firecrawl (if API key available)
 * 3. Analyze with Gemini
 * 4. Update prospect and company records
 * 5. Calculate score
 */
export async function enrichProspect(prospectId: string): Promise<{
  success: boolean;
  enrichmentData?: any;
  error?: string;
}> {
  try {
    // Load prospect with company data
    const prospects = await query<any[]>(
      `SELECT p.*, c.name as company_name, c.domain as company_domain,
              c.industry as company_industry, c.website_url as company_website
       FROM prospects p
       LEFT JOIN companies c ON p.company_id = c.id
       WHERE p.id = ?`,
      [prospectId]
    );

    if (prospects.length === 0) {
      return { success: false, error: 'Prospect not found.' };
    }

    const prospect = prospects[0];
    const tenantId = prospect.tenant_id;
    const tenant = tenantId ? await getTenantConfig(tenantId) : null;
    const tenantAI = tenant?.config?.ai;
    const enrichmentResults: any = {
      enriched_at: new Date().toISOString(),
      sources: [],
    };

    // Step 1: Research the company and prospect with Perplexity
    let perplexityData: string = '';
    try {
      const searchQuery = buildSearchQuery(prospect, tenantAI?.industry_context);
      perplexityData = await searchWithPerplexity(searchQuery, tenantAI?.perplexity_system);
      enrichmentResults.perplexity_research = perplexityData;
      enrichmentResults.sources.push('perplexity');
    } catch (err: any) {
      console.warn('Perplexity enrichment failed:', err.message);
      enrichmentResults.perplexity_error = err.message;
    }

    // Step 2: Scrape company website (if domain is available)
    let websiteData: string = '';
    if (prospect.company_domain) {
      try {
        const scrapeResult = await scrapeCompanyWebsite(prospect.company_domain);
        websiteData = scrapeResult;
        enrichmentResults.website_content = websiteData.substring(0, 5000); // Truncate for storage
        enrichmentResults.sources.push('website_scrape');
      } catch (err: any) {
        console.warn('Website scraping failed:', err.message);
        enrichmentResults.scrape_error = err.message;
      }
    }

    // Step 3: Analyze all collected data with Gemini
    let analysisResult: any = {};
    try {
      const analysisPrompt = buildAnalysisPrompt(prospect, perplexityData, websiteData, tenantAI?.industry_context);
      const geminiResponse = await enrichWithGemini(analysisPrompt);

      // Try to parse structured data from Gemini response
      const jsonMatch = geminiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      } else {
        analysisResult = { raw_analysis: geminiResponse };
      }

      enrichmentResults.ai_analysis = analysisResult;
      enrichmentResults.sources.push('gemini_analysis');
    } catch (err: any) {
      console.warn('Gemini analysis failed:', err.message);
      enrichmentResults.analysis_error = err.message;
    }

    // Step 4: Update prospect with enrichment data
    const updateFields: string[] = ['enrichment_data = ?'];
    const updateParams: any[] = [JSON.stringify(enrichmentResults)];

    // Update specific fields if we got structured data from Gemini
    if (analysisResult.seniority && !prospect.seniority) {
      updateFields.push('seniority = ?');
      updateParams.push(analysisResult.seniority);
    }

    if (analysisResult.department && !prospect.department) {
      updateFields.push('department = ?');
      updateParams.push(analysisResult.department);
    }

    // Mark as enriched
    if (prospect.status === 'new') {
      updateFields.push("status = 'enriched'");
    }

    updateParams.push(prospectId);

    await query(
      `UPDATE prospects SET ${updateFields.join(', ')} WHERE id = ?`,
      updateParams
    );

    // Step 4b: Update company record if we got new data
    if (prospect.company_id && analysisResult) {
      const companyUpdates: string[] = [];
      const companyParams: any[] = [];

      if (analysisResult.company_description && !prospect.company_description) {
        companyUpdates.push('description = ?');
        companyParams.push(analysisResult.company_description);
      }

      if (analysisResult.company_industry && !prospect.company_industry) {
        companyUpdates.push('industry = ?');
        companyParams.push(analysisResult.company_industry);
      }

      if (analysisResult.company_employee_count) {
        companyUpdates.push('employee_count = ?');
        companyParams.push(analysisResult.company_employee_count);
      }

      // Store the enrichment data on the company as well
      companyUpdates.push('enrichment_data = ?');
      companyParams.push(JSON.stringify({
        enriched_at: new Date().toISOString(),
        perplexity: perplexityData ? perplexityData.substring(0, 3000) : null,
        website: websiteData ? websiteData.substring(0, 3000) : null,
        analysis: analysisResult,
      }));

      if (companyUpdates.length > 0) {
        companyParams.push(prospect.company_id);
        await query(
          `UPDATE companies SET ${companyUpdates.join(', ')} WHERE id = ?`,
          companyParams
        );
      }
    }

    // Step 5: Calculate lead score based on new data
    try {
      await calculateScore(prospectId);
    } catch (err: any) {
      console.warn('Score calculation failed after enrichment:', err.message);
    }

    // Log activity
    await query(
      `INSERT INTO prospect_activities (id, prospect_id, tenant_id, activity_type, title, description, metadata)
       VALUES (?, ?, ?, 'enriched', 'Prospect enriched', ?, ?)`,
      [
        uuidv4(),
        prospectId,
        tenantId,
        `Enrichment sources: ${enrichmentResults.sources.join(', ')}`,
        JSON.stringify({ sources: enrichmentResults.sources }),
      ]
    );

    return { success: true, enrichmentData: enrichmentResults };
  } catch (error: any) {
    console.error('Enrichment failed for prospect', prospectId, ':', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Build a search query for Perplexity based on prospect data.
 * When industryContext is provided, asks about use cases relevant to that industry.
 */
function buildSearchQuery(prospect: any, industryContext?: string): string {
  const parts: string[] = [];

  if (prospect.company_name) {
    parts.push(`Company "${prospect.company_name}"`);
  }

  if (prospect.company_domain) {
    parts.push(`(${prospect.company_domain})`);
  }

  if (prospect.first_name && prospect.last_name) {
    parts.push(`person: ${prospect.first_name} ${prospect.last_name}`);
  }

  if (prospect.title) {
    parts.push(`title: ${prospect.title}`);
  }

  parts.push('- What does this company do?');
  parts.push('- Company size and revenue?');
  parts.push('- Industry and market focus?');
  parts.push('- Recent news or investments?');
  parts.push('- Key business activities and market position?');

  // Add industry-specific questions when tenant context is available
  if (industryContext) {
    parts.push(`- What specific use cases or opportunities related to ${industryContext} would be most relevant for this company?`);
    parts.push(`- What processes, departments, or workflows in this company could benefit from ${industryContext}?`);
    parts.push('- What challenges or pain points might this company face that are relevant to our services?');
  }

  return parts.join('\n');
}

/**
 * Build an analysis prompt for Gemini to extract structured data.
 * Always extracts suggested use cases — industry-specific if industryContext provided, otherwise general business opportunities.
 */
function buildAnalysisPrompt(prospect: any, perplexityData: string, websiteData: string, industryContext?: string): string {
  const useCaseInstruction = industryContext
    ? `\nIMPORTANT: For "suggested_use_cases", think specifically about how ${industryContext} could solve REAL problems for THIS company based on the research data. Be specific to their industry, size, and activities. Do not be generic.`
    : `\nIMPORTANT: For "suggested_use_cases", identify 3 specific business opportunities or improvements relevant to THIS company based on their industry and the research data. Think about tax optimization, operational efficiency, or innovation opportunities.`;

  return `Analyze the following data about a prospect and their company. Extract structured information.

PROSPECT:
- Name: ${prospect.first_name || ''} ${prospect.last_name || ''}
- Email: ${prospect.email}
- Title: ${prospect.title || 'Unknown'}
- Company: ${prospect.company_name || 'Unknown'}
- Domain: ${prospect.company_domain || 'Unknown'}

RESEARCH DATA:
${perplexityData || 'No research data available.'}

WEBSITE CONTENT:
${websiteData ? websiteData.substring(0, 3000) : 'No website data available.'}

Extract and return the following as JSON:
{
  "seniority": "C-Level/VP/Director/Manager/Individual Contributor",
  "department": "detected department",
  "company_description": "1-2 sentence company description",
  "company_industry": "primary industry",
  "company_employee_count": "estimated range like '51-200'",
  "company_annual_revenue": "estimated range",
  "investment_interest_score": 1-10,
  "business_relevance": "how relevant this prospect is for business engagement",
  "key_insights": ["insight 1", "insight 2"],
  "recommended_approach": "best approach to engage this prospect",
  "suggested_use_cases": ["specific opportunity 1 for this company", "opportunity 2", "opportunity 3"],
  "pain_points": ["specific challenge this company likely faces"]
}${useCaseInstruction}

Return ONLY valid JSON, no other text.`;
}
