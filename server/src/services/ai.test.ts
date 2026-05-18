/**
 * Unit tests for ai.ts — validateLanguageConsistency()
 *
 * Tests the lightweight language mixing detection that warns when
 * Spanish markers appear in Catalan emails (or vice versa).
 */

import { describe, it, expect, vi } from 'vitest';

// Mock external dependencies so ai.ts can be imported
vi.mock('../config/database', () => ({
  query: vi.fn(),
}));
vi.mock('../middleware/tenant', () => ({
  getTenantConfig: vi.fn(),
}));

import { validateLanguageConsistency } from './ai';

describe('validateLanguageConsistency', () => {
  describe('Catalan emails', () => {
    it('detects inverted question marks (¿) in Catalan', () => {
      const text = '¿Us interessaria valorar-ho?';
      const warnings = validateLanguageConsistency(text, 'catalan');
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('¿');
    });

    it('detects inverted exclamation marks (¡) in Catalan', () => {
      const text = '¡Fantàstic! Parlem-ne.';
      const warnings = validateLanguageConsistency(text, 'catalan');
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('¡');
    });

    it('detects Spanish closings in Catalan', () => {
      const text = 'Innovació fiscal per a la vostra empresa. Saludos cordiales, Alfons';
      const warnings = validateLanguageConsistency(text, 'catalan');
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('saludos cordiales');
    });

    it('detects "también" in Catalan', () => {
      const text = 'Podem ajudar-vos. También gestionem deduccions.';
      const warnings = validateLanguageConsistency(text, 'catalan');
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('también');
    });

    it('detects Spanish CTA in Catalan', () => {
      const text = 'Hem ajudat empreses similars. Os interesaría una valoració?';
      const warnings = validateLanguageConsistency(text, 'catalan');
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('os interesaría');
    });

    it('returns no warnings for clean Catalan email', () => {
      const text = 'Hola, A Tecnocim Innova hem ajudat empreses del vostre sector a recuperar fins al 42% de la inversió en innovació. Té sentit explorar-ho? Salutacions, Alfons Marquès';
      const warnings = validateLanguageConsistency(text, 'catalan');
      expect(warnings).toHaveLength(0);
    });
  });

  describe('Spanish emails', () => {
    it('detects Catalan closings in Spanish', () => {
      const text = 'Hemos ayudado a empresas similares. Salutacions, Alfons';
      const warnings = validateLanguageConsistency(text, 'spanish');
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('salutacions');
    });

    it('detects Catalan greetings in Spanish', () => {
      const text = 'Bon dia, hemos visto que su empresa invierte en innovación.';
      const warnings = validateLanguageConsistency(text, 'spanish');
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('bon dia');
    });

    it('detects Catalan pronoun suffixes in Spanish', () => {
      const text = '¿Tiene sentido explorar-ho? Un saludo.';
      const warnings = validateLanguageConsistency(text, 'spanish');
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('explorar-ho');
    });

    it('returns no warnings for clean Spanish email', () => {
      const text = 'Hola, En Tecnocim Innova hemos ayudado a empresas de su sector a recuperar hasta el 42% de la inversión en innovación. ¿Tiene sentido explorarlo? Saludos cordiales, Alfons Marquès';
      const warnings = validateLanguageConsistency(text, 'spanish');
      expect(warnings).toHaveLength(0);
    });
  });

  describe('English emails', () => {
    it('returns no warnings for English (no cross-language checks)', () => {
      const text = 'Hi, We help companies recover up to 42% of their innovation investment. Worth exploring? Best regards, Alfons';
      const warnings = validateLanguageConsistency(text, 'english');
      expect(warnings).toHaveLength(0);
    });
  });
});
