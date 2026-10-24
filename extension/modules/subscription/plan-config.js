// plan-config.js - Plan definitions, limits, and pricing
// Single source of truth for all subscription-related constants.
// Used by both popup and content scripts.

var PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    limits: {
      applicationsPerMonth: 10,
      hrMessagesPerMonth: 10,
      searchTerms: 3,
      messageTemplates: 1,
      aiAnswers: false,
    },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    limits: {
      applicationsPerMonth: 50,
      hrMessagesPerMonth: 50,
      searchTerms: Infinity,
      messageTemplates: Infinity,
      aiAnswers: true,
    },
  },
};

var PRICING = {
  monthly: {
    id: 'monthly',
    label: '1 Month',
    price: 299,
    currency: 'INR',
    period: 30, // days
    savings: null,
  },
  quarterly: {
    id: 'quarterly',
    label: '3 Months',
    price: 699,
    currency: 'INR',
    period: 90,
    savings: '22% off',
    perMonth: 233,
  },
  half_yearly: {
    id: 'half_yearly',
    label: '6 Months',
    price: 1499,
    currency: 'INR',
    period: 180,
    savings: '16% off',
    perMonth: 250,
  },
  yearly: {
    id: 'yearly',
    label: '1 Year',
    price: 2999,
    currency: 'INR',
    period: 365,
    savings: '58% off',
    perMonth: 250,
    popular: true,
  },
};

/**
 * Get the limits for a given plan.
 * @param {string} planId - 'free' or 'pro'
 * @returns {object} limits
 */
function getPlanLimits(planId) {
  return PLANS[planId]?.limits || PLANS.free.limits;
}

/**
 * Get pricing details for a billing period.
 * @param {string} periodId - 'monthly', 'quarterly', 'half_yearly', 'yearly'
 * @returns {object} pricing
 */
function getPricing(periodId) {
  return PRICING[periodId] || PRICING.monthly;
}

/**
 * Get all pricing options as an array (for rendering).
 * @returns {object[]}
 */
function getAllPricingOptions() {
  return Object.values(PRICING);
}
