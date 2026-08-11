/** Shared types for CampaignDetail sub-components */

// Minimal campaign shape as returned by campaignsApi.get()
export interface CampaignData {
  id: string;
  name: string;
  status?: string;
  description?: string;
  asset_type?: string;
  asset_location?: string;
  sender_user_id?: string | null;
  sender_name?: string | null;
  sender_email?: string | null;
  prospect_count?: number;
  prospects?: Record<string, unknown>[];
  emailStats?: {
    sent?: number;
    replied?: number;
    opened?: number;
    clicked?: number;
    bounced?: number;
  };
}

export interface GeneratedEmailsData {
  emails: GeneratedEmail[];
  byProspect: EmailGroup[];
  stats: Record<string, number>;
}

export interface GeneratedEmail {
  id: string;
  prospect_id: string;
  step_number: number;
  delay_days: number;
  subject: string;
  body_html: string;
  status: string;
}

export interface EmailGroup {
  prospect_id: string;
  prospect_name: string;
  prospect_email: string;
  prospect_title?: string;
  emails: GeneratedEmail[];
}
