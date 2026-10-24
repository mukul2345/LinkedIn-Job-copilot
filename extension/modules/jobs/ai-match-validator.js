// ai-match-validator.js - Strict validation for untrusted model output.

function sanitizeStringArray(value, maximumItems = 25) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => typeof item === 'string')
    .map(item => item.trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, maximumItems);
}

function recommendationForScore(score) {
  if (score >= 85) return MatchRecommendation.STRONG_MATCH;
  if (score >= 70) return MatchRecommendation.MATCH;
  if (score >= 40) return MatchRecommendation.WEAK_MATCH;
  return MatchRecommendation.NO_MATCH;
}

/** Invalid AI output remains unavailable and never becomes a fabricated score. */
function validateAiMatchResponse(value) {
  if (!value || typeof value !== 'object') {
    return { available: false, errorCode: 'INVALID_AI_RESPONSE' };
  }
  const score = Number(value.score);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    return { available: false, errorCode: 'INVALID_AI_SCORE' };
  }
  const normalizedScore = Math.round(score);
  const validRecommendations = Object.values(MatchRecommendation);
  const recommendation = validRecommendations.includes(value.recommendation)
    ? value.recommendation
    : recommendationForScore(normalizedScore);
  return {
    available: true,
    score: normalizedScore,
    recommendation,
    matchedSkills: sanitizeStringArray(value.matchedSkills),
    missingSkills: sanitizeStringArray(value.missingSkills),
    reasons: sanitizeStringArray(value.reasons, 10),
  };
}
