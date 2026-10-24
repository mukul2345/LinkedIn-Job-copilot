// errors.js - Structured extension error hierarchy.

// eslint-disable-next-line no-var
var ExtensionError = (function () {
  function ExtensionError(options = {}) {
    const instance = new Error(options.message || 'Extension operation failed.', { cause: options.cause });
    instance.name = 'ExtensionError';
    instance.code = options.code || 'EXTENSION_ERROR';
    instance.status = options.status ?? null;
    instance.retryable = options.retryable === true;
    instance.cause = options.cause;
    Object.setPrototypeOf(instance, ExtensionError.prototype);
    return instance;
  }
  ExtensionError.prototype = Object.create(Error.prototype);
  ExtensionError.prototype.constructor = ExtensionError;
  return ExtensionError;
})();

function createExtensionErrorType(name, defaultCode, retryable) {
  function TypedExtensionError(options = {}) {
    const instance = new ExtensionError({ ...options, code: options.code || defaultCode, retryable });
    instance.name = name;
    Object.setPrototypeOf(instance, TypedExtensionError.prototype);
    return instance;
  }
  TypedExtensionError.prototype = Object.create(ExtensionError.prototype);
  TypedExtensionError.prototype.constructor = TypedExtensionError;
  return TypedExtensionError;
}

// eslint-disable-next-line no-var
var ValidationExtensionError = createExtensionErrorType('ValidationExtensionError', 'VALIDATION_ERROR', false);
// eslint-disable-next-line no-var
var AuthenticationExtensionError = createExtensionErrorType('AuthenticationExtensionError', 'UNAUTHORIZED', false);
// eslint-disable-next-line no-var
var RateLimitExtensionError = createExtensionErrorType('RateLimitExtensionError', 'RATE_LIMITED', true);
// eslint-disable-next-line no-var
var TimeoutExtensionError = createExtensionErrorType('TimeoutExtensionError', 'TIMEOUT', true);
// eslint-disable-next-line no-var
var NetworkExtensionError = createExtensionErrorType('NetworkExtensionError', 'NETWORK_ERROR', true);
// eslint-disable-next-line no-var
var MalformedResponseExtensionError = createExtensionErrorType('MalformedResponseExtensionError', 'MALFORMED_RESPONSE', false);
