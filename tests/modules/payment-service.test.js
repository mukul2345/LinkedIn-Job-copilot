// tests/modules/payment-service.test.js - Unit tests for payment-service.js

const { loadModules } = require('../helpers/load-modules');

// Mock fetch globally
global.fetch = jest.fn();

// Mock getCurrentUser
global.getCurrentUser = jest.fn();

beforeAll(() => {
  loadModules(['constants.js', 'plan-config.js', 'usage-repository.js', 'plan-service.js']);
  // Load payment-service manually since it's not in the content script path map
  const { loadModuleByPath } = require('../helpers/load-modules');
  loadModuleByPath('modules/subscription/payment-service.js');
});

beforeEach(() => {
  resetChromeMocks();
  fetch.mockClear();
  getCurrentUser.mockReturnValue(null);
});

describe('initiatePayment()', () => {
  const mockUser = {
    getIdToken: jest.fn().mockResolvedValue('mock-id-token-123'),
    uid: 'user123',
    email: 'test@example.com',
  };

  const mockPricing = { id: 'monthly', price: 299, label: '1 Month', period: 30 };

  it('should call createPaymentSession with auth token', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        orderId: 'order_test_123',
        paymentSessionId: 'session_abc',
        paymentLink: 'https://payments.cashfree.com/checkout/session_abc',
        environment: 'production',
      }),
    });

    const result = await initiatePayment(mockUser, mockPricing);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/createPaymentSession'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer mock-id-token-123',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ planId: 'monthly' }),
      })
    );
    expect(result.success).toBe(true);
    expect(result.orderId).toBe('order_test_123');
  });

  it('should store pending payment in chrome.storage', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        orderId: 'order_test_456',
        paymentSessionId: 'session_def',
        paymentLink: 'https://payments.cashfree.com/checkout/session_def',
        environment: 'production',
      }),
    });

    await initiatePayment(mockUser, mockPricing);

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingPayment: expect.objectContaining({
          orderId: 'order_test_456',
          planId: 'monthly',
          amount: 299,
        }),
      }),
      expect.any(Function)
    );
  });

  it('should open payment link in new tab', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        orderId: 'order_test_789',
        paymentSessionId: 'session_ghi',
        paymentLink: 'https://payments.cashfree.com/checkout/session_ghi',
        environment: 'production',
      }),
    });

    await initiatePayment(mockUser, mockPricing);

    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'https://payments.cashfree.com/checkout/session_ghi',
    });
  });

  it('should return error when API fails', async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Server error' }),
    });

    const result = await initiatePayment(mockUser, mockPricing);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Server error');
  });

  it('should return error when fetch throws', async () => {
    fetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await initiatePayment(mockUser, mockPricing);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Network error');
  });

  it('should build checkout URL from session ID when no paymentLink', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        orderId: 'order_no_link',
        paymentSessionId: 'session_xyz',
        paymentLink: null,
        environment: 'production',
      }),
    });

    await initiatePayment(mockUser, mockPricing);

    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: expect.stringContaining('session_xyz'),
    });
  });
});

describe('verifyPendingPayment()', () => {
  it('should return none if no pending payment', async () => {
    const result = await verifyPendingPayment();
    expect(result.status).toBe('none');
  });

  it('should return unauthenticated if no user', async () => {
    setMockStorageData({
      pendingPayment: { orderId: 'order_123', planId: 'monthly', amount: 299 },
    });
    getCurrentUser.mockReturnValue(null);

    const result = await verifyPendingPayment();
    expect(result.status).toBe('unauthenticated');
  });

  it('should call verifyPayment endpoint with auth token', async () => {
    setMockStorageData({
      pendingPayment: { orderId: 'order_verify_1', planId: 'monthly', amount: 299 },
    });
    getCurrentUser.mockReturnValue({
      getIdToken: jest.fn().mockResolvedValue('token-abc'),
    });

    fetch.mockResolvedValueOnce({
      json: async () => ({ status: 'pending' }),
    });

    await verifyPendingPayment();

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/verifyPayment'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer token-abc',
        }),
        body: JSON.stringify({ orderId: 'order_verify_1' }),
      })
    );
  });

  it('should clear pending payment and return paid on success', async () => {
    setMockStorageData({
      pendingPayment: { orderId: 'order_paid_1', planId: 'yearly', amount: 2999 },
    });
    getCurrentUser.mockReturnValue({
      getIdToken: jest.fn().mockResolvedValue('token-xyz'),
    });

    fetch.mockResolvedValueOnce({
      json: async () => ({ status: 'paid', planId: 'yearly' }),
    });

    const result = await verifyPendingPayment();

    expect(result.status).toBe('paid');
    expect(result.planId).toBe('yearly');
    expect(chrome.storage.local.remove).toHaveBeenCalledWith('pendingPayment', expect.any(Function));
  });

  it('should return pending status without clearing', async () => {
    setMockStorageData({
      pendingPayment: { orderId: 'order_pending_1', planId: 'monthly', amount: 299 },
    });
    getCurrentUser.mockReturnValue({
      getIdToken: jest.fn().mockResolvedValue('token-123'),
    });

    fetch.mockResolvedValueOnce({
      json: async () => ({ status: 'active' }),
    });

    const result = await verifyPendingPayment();

    expect(result.status).toBe('active');
    expect(chrome.storage.local.remove).not.toHaveBeenCalled();
  });

  it('should handle fetch errors gracefully', async () => {
    setMockStorageData({
      pendingPayment: { orderId: 'order_err_1', planId: 'monthly', amount: 299 },
    });
    getCurrentUser.mockReturnValue({
      getIdToken: jest.fn().mockResolvedValue('token-err'),
    });

    fetch.mockRejectedValueOnce(new Error('Network timeout'));

    const result = await verifyPendingPayment();
    expect(result.status).toBe('error');
  });
});
