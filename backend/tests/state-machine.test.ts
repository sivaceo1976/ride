import { describe, it, expect } from 'vitest';
import { RideStatus, canTransitionRide } from '../src/modules/rides/types.js';
import { generatePickupOtp, verifyPickupOtp } from '../src/utils/otp.js';

describe('Ride State Machine & Verification Logic', () => {
  describe('Deterministic State Transitions', () => {
    it('should allow valid sequential lifecycle: REQUESTED -> SEARCHING -> ASSIGNED -> ACCEPTED -> ARRIVED -> IN_TRANSIT -> COMPLETED', () => {
      expect(canTransitionRide(RideStatus.REQUESTED, RideStatus.SEARCHING_DRIVER)).toBe(true);
      expect(canTransitionRide(RideStatus.SEARCHING_DRIVER, RideStatus.ASSIGNED)).toBe(true);
      expect(canTransitionRide(RideStatus.ASSIGNED, RideStatus.ACCEPTED)).toBe(true);
      expect(canTransitionRide(RideStatus.ACCEPTED, RideStatus.ARRIVED_AT_PICKUP)).toBe(true);
      expect(canTransitionRide(RideStatus.ARRIVED_AT_PICKUP, RideStatus.IN_TRANSIT)).toBe(true);
      expect(canTransitionRide(RideStatus.IN_TRANSIT, RideStatus.COMPLETED)).toBe(true);
    });

    it('should allow driver reject/timeout cycle: ASSIGNED -> SEARCHING_DRIVER', () => {
      expect(canTransitionRide(RideStatus.ASSIGNED, RideStatus.SEARCHING_DRIVER)).toBe(true);
    });

    it('should allow cancellation from all pre-completion states', () => {
      expect(canTransitionRide(RideStatus.REQUESTED, RideStatus.CANCELLED)).toBe(true);
      expect(canTransitionRide(RideStatus.SEARCHING_DRIVER, RideStatus.CANCELLED)).toBe(true);
      expect(canTransitionRide(RideStatus.ASSIGNED, RideStatus.CANCELLED)).toBe(true);
      expect(canTransitionRide(RideStatus.ACCEPTED, RideStatus.CANCELLED)).toBe(true);
      expect(canTransitionRide(RideStatus.ARRIVED_AT_PICKUP, RideStatus.CANCELLED)).toBe(true);
      expect(canTransitionRide(RideStatus.IN_TRANSIT, RideStatus.CANCELLED)).toBe(true);
    });

    it('should forbid illegal skip transitions', () => {
      // Cannot jump from REQUESTED straight to IN_TRANSIT
      expect(canTransitionRide(RideStatus.REQUESTED, RideStatus.IN_TRANSIT)).toBe(false);
      // Cannot jump from REQUESTED straight to COMPLETED
      expect(canTransitionRide(RideStatus.REQUESTED, RideStatus.COMPLETED)).toBe(false);
      // Cannot transition out of terminal COMPLETED state
      expect(canTransitionRide(RideStatus.COMPLETED, RideStatus.IN_TRANSIT)).toBe(false);
      expect(canTransitionRide(RideStatus.COMPLETED, RideStatus.CANCELLED)).toBe(false);
      // Cannot transition out of terminal CANCELLED state
      expect(canTransitionRide(RideStatus.CANCELLED, RideStatus.SEARCHING_DRIVER)).toBe(false);
    });
  });

  describe('OTP Generation and Verification', () => {
    it('should generate a 4-digit numeric string', () => {
      for (let i = 0; i < 50; i++) {
        const otp = generatePickupOtp();
        expect(otp).toMatch(/^\d{4}$/);
        expect(otp.length).toBe(4);
      }
    });

    it('should verify matching OTP correctly', () => {
      const otp = '4821';
      expect(verifyPickupOtp('4821', otp)).toBe(true);
      expect(verifyPickupOtp(' 4821 ', otp)).toBe(true); // with whitespace trim
    });

    it('should reject non-matching or malformed OTPs', () => {
      const otp = '4821';
      expect(verifyPickupOtp('0000', otp)).toBe(false);
      expect(verifyPickupOtp('482', otp)).toBe(false);
      expect(verifyPickupOtp('48210', otp)).toBe(false);
      expect(verifyPickupOtp('abcd', otp)).toBe(false);
    });
  });
});
