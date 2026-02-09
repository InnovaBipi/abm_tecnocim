import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor: handle 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// ── Auth ──────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),

  register: (data: { name: string; email: string; password: string }) =>
    api.post('/auth/register', data),

  getMe: () =>
    api.get('/auth/me'),
};

// ── Prospects ─────────────────────────────────────────────────────────────────

export interface ProspectFilters {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  source?: string;
  scoreMin?: number;
  scoreMax?: number;
  companyId?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export const prospectsApi = {
  list: (params?: ProspectFilters) =>
    api.get('/prospects', { params }),

  get: (id: string) =>
    api.get(`/prospects/${id}`),

  create: (data: Record<string, unknown>) =>
    api.post('/prospects', data),

  update: (id: string, data: Record<string, unknown>) =>
    api.put(`/prospects/${id}`, data),

  delete: (id: string) =>
    api.delete(`/prospects/${id}`),

  bulkDelete: (ids: string[]) =>
    api.post('/prospects/bulk-delete', { ids }),

  bulkAddToCampaign: (ids: string[], campaignId: string) =>
    api.post('/prospects/bulk-add-campaign', { ids, campaign_id: campaignId }),

  enrich: (id: string) =>
    api.post(`/prospects/${id}/enrich`),

  recalculateScore: (id: string) =>
    api.post(`/prospects/${id}/recalculate-score`),
};

// ── Companies ─────────────────────────────────────────────────────────────────

export interface CompanyFilters {
  page?: number;
  limit?: number;
  search?: string;
  tier?: string;
  industry?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export const companiesApi = {
  list: (params?: CompanyFilters) =>
    api.get('/companies', { params }),

  get: (id: string) =>
    api.get(`/companies/${id}`),

  create: (data: Record<string, unknown>) =>
    api.post('/companies', data),

  update: (id: string, data: Record<string, unknown>) =>
    api.put(`/companies/${id}`, data),

  delete: (id: string) =>
    api.delete(`/companies/${id}`),
};

// ── Campaigns ─────────────────────────────────────────────────────────────────

export interface CampaignFilters {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export const campaignsApi = {
  list: (params?: CampaignFilters) =>
    api.get('/campaigns', { params }),

  get: (id: string) =>
    api.get(`/campaigns/${id}`),

  create: (data: Record<string, unknown>) =>
    api.post('/campaigns', data),

  update: (id: string, data: Record<string, unknown>) =>
    api.put(`/campaigns/${id}`, data),

  delete: (id: string) =>
    api.delete(`/campaigns/${id}`),

  addProspects: (id: string, prospectIds: string[]) =>
    api.post(`/campaigns/${id}/prospects`, { prospect_ids: prospectIds }),

  removeProspect: (id: string, prospectId: string) =>
    api.delete(`/campaigns/${id}/prospects/${prospectId}`),
};

// ── Sequences ─────────────────────────────────────────────────────────────────

export interface SequenceFilters {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  campaignId?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export const sequencesApi = {
  list: (params?: SequenceFilters) =>
    api.get('/sequences', { params }),

  get: (id: string) =>
    api.get(`/sequences/${id}`),

  create: (data: Record<string, unknown>) =>
    api.post('/sequences', data),

  update: (id: string, data: Record<string, unknown>) =>
    api.put(`/sequences/${id}`, data),

  delete: (id: string) =>
    api.delete(`/sequences/${id}`),

  addSteps: (id: string, steps: Record<string, unknown>[]) =>
    api.post(`/sequences/${id}/steps`, { steps }),

  enroll: (id: string, prospectIds: string[]) =>
    api.post(`/sequences/${id}/enroll`, { prospectIds }),

  pause: (id: string) =>
    api.post(`/sequences/${id}/pause`),

  resume: (id: string) =>
    api.post(`/sequences/${id}/resume`),

  generateStep: (id: string, stepNumber: number, prospectId?: string) =>
    api.post(`/sequences/${id}/generate-step`, { step_number: stepNumber, prospect_id: prospectId }),
};

// ── Imports ───────────────────────────────────────────────────────────────────

export const importsApi = {
  upload: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/imports/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  map: (importId: string, mapping: Record<string, string>) =>
    api.post(`/imports/${importId}/map`, { column_mapping: mapping }),

  getStatus: (importId: string) =>
    api.get(`/imports/${importId}`),

  list: (params?: { page?: number; limit?: number }) =>
    api.get('/imports', { params }),
};

// ── Dashboard ─────────────────────────────────────────────────────────────────

export const dashboardApi = {
  getStats: () =>
    api.get('/dashboard/stats'),

  getRecentActivity: (params?: { limit?: number }) =>
    api.get('/dashboard/recent-activity', { params }),

  getTopProspects: (params?: { limit?: number }) =>
    api.get('/dashboard/top-prospects', { params }),

  getCampaignPerformance: () =>
    api.get('/dashboard/campaign-performance'),
};

// ── Settings ──────────────────────────────────────────────────────────────────

export const settingsApi = {
  getProfile: () =>
    api.get('/settings/profile'),

  updateProfile: (data: Record<string, unknown>) =>
    api.put('/settings/profile', data),

  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    api.put('/settings/password', data),

  getEmailSettings: () =>
    api.get('/settings/email'),

  updateEmailSettings: (data: Record<string, unknown>) =>
    api.put('/settings/email', data),

  getApiKeys: () =>
    api.get('/settings/api-keys'),

  getScoringRules: () =>
    api.get('/settings/scoring-rules'),

  createScoringRule: (data: Record<string, unknown>) =>
    api.post('/settings/scoring-rules', data),

  updateScoringRule: (id: string, data: Record<string, unknown>) =>
    api.put(`/settings/scoring-rules/${id}`, data),

  deleteScoringRule: (id: string) =>
    api.delete(`/settings/scoring-rules/${id}`),
};

export default api;
