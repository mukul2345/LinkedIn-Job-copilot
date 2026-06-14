// tests/modules/visa-service.test.js - Unit tests for functions/lib/sponsorship.js

const {
  classifySponsorshipStatus,
  POSITIVE_INDICATORS,
  NEGATIVE_INDICATORS,
  VISA_RELATED_TERMS,
} = require('../../functions/lib/sponsorship');

describe('classifySponsorshipStatus()', () => {
  describe('positive indicators → "available"', () => {
    it('returns "available" when description contains "visa sponsorship"', async () => {
      const result = await classifySponsorshipStatus(
        'We offer visa sponsorship for qualified candidates.',
        false
      );
      expect(result).toEqual({ status: 'available', confidence: 'full' });
    });

    it('returns "available" when description contains "h-1b"', async () => {
      const result = await classifySponsorshipStatus(
        'This role is eligible for H-1B transfer.',
        false
      );
      expect(result).toEqual({ status: 'available', confidence: 'full' });
    });

    it('returns "available" when description contains "h1b"', async () => {
      const result = await classifySponsorshipStatus(
        'H1B sponsorship is provided for this position.',
        false
      );
      expect(result).toEqual({ status: 'available', confidence: 'full' });
    });

    it('returns "available" when description contains "will sponsor"', async () => {
      const result = await classifySponsorshipStatus(
        'We will sponsor the right candidate.',
        false
      );
      expect(result).toEqual({ status: 'available', confidence: 'full' });
    });

    it('returns "available" even if negative indicators are also present', async () => {
      const result = await classifySponsorshipStatus(
        'Must be authorized to work in the US. We will sponsor visa if needed.',
        false
      );
      expect(result).toEqual({ status: 'available', confidence: 'full' });
    });

    it('is case-insensitive', async () => {
      const result = await classifySponsorshipStatus(
        'VISA SPONSORSHIP available for this role.',
        false
      );
      expect(result).toEqual({ status: 'available', confidence: 'full' });
    });
  });

  describe('negative indicators → "unlikely"', () => {
    it('returns "unlikely" for "must be authorized to work"', async () => {
      const result = await classifySponsorshipStatus(
        'Candidates must be authorized to work in the United States.',
        false
      );
      expect(result).toEqual({ status: 'unlikely', confidence: 'full' });
    });

    it('returns "unlikely" for "no sponsorship"', async () => {
      const result = await classifySponsorshipStatus(
        'No sponsorship is available for this role.',
        false
      );
      expect(result).toEqual({ status: 'unlikely', confidence: 'full' });
    });

    it('returns "unlikely" for "us citizens only"', async () => {
      const result = await classifySponsorshipStatus(
        'This position is open to US citizens only.',
        false
      );
      expect(result).toEqual({ status: 'unlikely', confidence: 'full' });
    });

    it('returns "unlikely" for "unable to sponsor"', async () => {
      const result = await classifySponsorshipStatus(
        'We are unable to sponsor work visas at this time.',
        false
      );
      expect(result).toEqual({ status: 'unlikely', confidence: 'full' });
    });

    it('returns "unlikely" for "authorized to work without"', async () => {
      const result = await classifySponsorshipStatus(
        'Must be authorized to work without company sponsorship.',
        false
      );
      expect(result).toEqual({ status: 'unlikely', confidence: 'full' });
    });
  });

  describe('ambiguous visa language', () => {
    it('returns "unknown" with reduced confidence when AI is unavailable', async () => {
      const result = await classifySponsorshipStatus(
        'Please note your visa status in the application.',
        false
      );
      expect(result).toEqual({ status: 'unknown', confidence: 'reduced' });
    });

    it('uses AI classification when available', async () => {
      const mockAI = jest.fn().mockResolvedValue('available');
      const result = await classifySponsorshipStatus(
        'Please discuss your visa requirements during the interview.',
        true,
        mockAI
      );
      expect(result).toEqual({ status: 'available', confidence: 'full' });
      expect(mockAI).toHaveBeenCalled();
    });

    it('returns AI result with full confidence for ambiguous text', async () => {
      const mockAI = jest.fn().mockResolvedValue('unlikely');
      const result = await classifySponsorshipStatus(
        'Immigration status will be verified.',
        true,
        mockAI
      );
      expect(result).toEqual({ status: 'unlikely', confidence: 'full' });
    });
  });

  describe('no visa language → "unknown"', () => {
    it('returns "unknown" with "full" confidence when AI is available', async () => {
      const result = await classifySponsorshipStatus(
        'We are looking for a senior software engineer with 5 years of experience in React.',
        true
      );
      expect(result).toEqual({ status: 'unknown', confidence: 'full' });
    });

    it('returns "unknown" with "reduced" confidence when AI is unavailable', async () => {
      const result = await classifySponsorshipStatus(
        'We are looking for a senior software engineer with 5 years of experience in React.',
        false
      );
      expect(result).toEqual({ status: 'unknown', confidence: 'reduced' });
    });
  });

  describe('edge cases', () => {
    it('handles empty string description', async () => {
      const result = await classifySponsorshipStatus('', false);
      expect(result).toEqual({ status: 'unknown', confidence: 'reduced' });
    });

    it('handles null description', async () => {
      const result = await classifySponsorshipStatus(null, false);
      expect(result).toEqual({ status: 'unknown', confidence: 'reduced' });
    });

    it('handles undefined description', async () => {
      const result = await classifySponsorshipStatus(undefined, true);
      expect(result).toEqual({ status: 'unknown', confidence: 'full' });
    });
  });

  describe('keyword list completeness', () => {
    it('POSITIVE_INDICATORS contains all required keywords', () => {
      const required = [
        'visa sponsorship',
        'h-1b',
        'h1b',
        'work permit assistance',
        'j-1 sponsorship',
        'j1 sponsorship',
        'employer-sponsored work visa',
        'sponsor international candidates',
        'sponsorship available',
        'will sponsor',
        'provides sponsorship',
        'open to sponsoring',
      ];
      for (const kw of required) {
        expect(POSITIVE_INDICATORS).toContain(kw);
      }
    });

    it('NEGATIVE_INDICATORS contains all required keywords', () => {
      const required = [
        'must be authorized to work',
        'no sponsorship',
        'us citizens only',
        'u.s. citizens only',
        'requires active security clearance',
        'permanent resident required',
        'not able to sponsor',
        'unable to sponsor',
        'cannot sponsor',
        'without sponsorship',
        'no visa sponsorship',
        'must have existing right to work',
        'authorized to work without',
      ];
      for (const kw of required) {
        expect(NEGATIVE_INDICATORS).toContain(kw);
      }
    });
  });
});
