/**
 * Visa Sponsorship Classification Utility
 *
 * Pure classification logic with no Firebase dependencies.
 * Exported for reuse in Cloud Functions and for unit testing.
 */

// ============================================================
// Keyword Lists
// ============================================================

const POSITIVE_INDICATORS = [
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

const NEGATIVE_INDICATORS = [
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

// Terms that indicate visa-related language is present (but may be ambiguous)
const VISA_RELATED_TERMS = [
  'visa',
  'sponsorship',
  'work authorization',
  'work permit',
  'immigration',
  'h-1b',
  'green card',
  'ead',
  'opt',
  'cpt',
];

// ============================================================
// Core Classification Logic
// ============================================================

/**
 * Classify visa sponsorship status from job description text.
 *
 * Priority order:
 * 1. Positive indicators found → "available" (confidence: "full")
 * 2. Negative indicators found (no positive) → "unlikely" (confidence: "full")
 * 3. Ambiguous visa language → AI if available (confidence: "full"), else keyword-only (confidence: "reduced")
 * 4. No visa language → "unknown" (confidence: "full" if AI available, "reduced" if not)
 *
 * @param {string} description - Full job description text
 * @param {boolean} [aiAvailable=false] - Whether the AI engine is reachable
 * @param {Function} [aiClassify] - AI classification function for ambiguous cases
 * @returns {Promise<{status: string, confidence: string}>}
 */
async function classifySponsorshipStatus(description, aiAvailable, aiClassify) {
  if (!description || typeof description !== 'string') {
    return { status: 'unknown', confidence: aiAvailable ? 'full' : 'reduced' };
  }

  const lowerDesc = description.toLowerCase();

  // Step 1: Check positive indicators (highest priority)
  const hasPositive = POSITIVE_INDICATORS.some((kw) => lowerDesc.includes(kw));
  if (hasPositive) {
    return { status: 'available', confidence: 'full' };
  }

  // Step 2: Check negative indicators
  const hasNegative = NEGATIVE_INDICATORS.some((kw) => lowerDesc.includes(kw));
  if (hasNegative) {
    return { status: 'unlikely', confidence: 'full' };
  }

  // Step 3: Check for any visa-related language (ambiguous case)
  const hasVisaLanguage = VISA_RELATED_TERMS.some((term) => lowerDesc.includes(term));

  if (hasVisaLanguage) {
    // Ambiguous case — use AI if available
    if (aiAvailable && aiClassify) {
      const aiResult = await aiClassify(description);
      return { status: aiResult, confidence: 'full' };
    }
    // Fallback: keyword-only cannot determine
    return { status: 'unknown', confidence: 'reduced' };
  }

  // Step 4: No visa-related language at all
  return { status: 'unknown', confidence: aiAvailable ? 'full' : 'reduced' };
}

module.exports = {
  classifySponsorshipStatus,
  POSITIVE_INDICATORS,
  NEGATIVE_INDICATORS,
  VISA_RELATED_TERMS,
};
