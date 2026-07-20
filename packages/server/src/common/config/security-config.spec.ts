import jwtConfig from './jwt';
import signupRestrictionsConfig from './signup-restrictions';

describe('production security configuration', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalJwtSecret = process.env.APP_JWT_SECRET;
  const originalSignupDisabled = process.env.SIGNUP_DISABLED;

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;

    if (originalJwtSecret === undefined) delete process.env.APP_JWT_SECRET;
    else process.env.APP_JWT_SECRET = originalJwtSecret;

    if (originalSignupDisabled === undefined)
      delete process.env.SIGNUP_DISABLED;
    else process.env.SIGNUP_DISABLED = originalSignupDisabled;
  });

  it('fails closed when a production JWT secret is missing or too short', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.APP_JWT_SECRET;
    expect(() => jwtConfig()).toThrow(/APP_JWT_SECRET/);

    process.env.APP_JWT_SECRET = 'too-short';
    expect(() => jwtConfig()).toThrow(/at least 64 characters/);
  });

  it('uses the configured production JWT secret', () => {
    const secret = 'a'.repeat(64);
    process.env.NODE_ENV = 'production';
    process.env.APP_JWT_SECRET = secret;

    expect(jwtConfig()).toEqual({ secret });
    expect(jwtConfig().secret).not.toBe('123123');
  });

  it('defaults signup to disabled in production but permits explicit test opt-in', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SIGNUP_DISABLED;
    expect(signupRestrictionsConfig().disabled).toBe(true);

    process.env.NODE_ENV = 'test';
    process.env.SIGNUP_DISABLED = 'false';
    expect(signupRestrictionsConfig().disabled).toBe(false);
  });
});
