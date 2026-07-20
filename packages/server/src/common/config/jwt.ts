import { registerAs } from '@nestjs/config';

const getJwtSecret = (): string => {
  const secret = process.env.APP_JWT_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && !secret) {
    throw new Error('APP_JWT_SECRET is required in production.');
  }
  if (isProduction && secret.length < 64) {
    throw new Error('APP_JWT_SECRET must be at least 64 characters.');
  }

  return secret ?? 'development-only-jwt-secret-not-for-production';
};

export default registerAs('jwt', () => ({ secret: getJwtSecret() }));
