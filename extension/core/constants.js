// constants.js - Application-wide constants
// Using var so it's accessible across all content script files in the same injection
// eslint-disable-next-line no-var
var APP_NAME = 'JobPilot AI';
// eslint-disable-next-line no-var
var APP_VERSION = '1.3.0';

// User roles (stored in Firestore users collection)
// eslint-disable-next-line no-var
var USER_ROLES = {
  ADMIN: 'admin',    // Full access, unlimited everything, can manage users
  USER: 'user',      // Regular user, subject to plan limits
};

// Plan types (stored in Firestore users collection)
// eslint-disable-next-line no-var
var PLAN_TYPES = {
  FREE: 'free',
  PRO: 'pro',
};

// User ID prefix format: USR@00001, USR@00002, etc.
// eslint-disable-next-line no-var
var USER_ID_PREFIX = 'USR';
