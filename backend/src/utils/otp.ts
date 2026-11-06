import crypto from 'node:crypto';

/**
 * Generates a cryptographically secure 4-digit numeric OTP.
 * Generates values strictly between '0000' and '9999'.
 */
export function generatePickupOtp(): string {
  const randomValue = crypto.randomInt(0, 10000);
  return randomValue.toString().padStart(4, '0');
}

/**
 * Validates a submitted OTP against the stored ride OTP using constant-time comparison
 * to prevent timing attacks.
 */
export function verifyPickupOtp(submittedOtp: string, actualOtp: string): boolean {
  if (typeof submittedOtp !== 'string' || typeof actualOtp !== 'string') {
    return false;
  }

  const cleanSubmitted = submittedOtp.trim();
  const cleanActual = actualOtp.trim();

  if (cleanSubmitted.length !== 4 || cleanActual.length !== 4) {
    return false;
  }

  const bufSubmitted = Buffer.from(cleanSubmitted);
  const bufActual = Buffer.from(cleanActual);

  return crypto.timingSafeEqual(bufSubmitted, bufActual);
}
