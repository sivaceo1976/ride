import { UserRole } from '../modules/users/types.js';
import { VehicleClass } from '../modules/vehicles/types.js';
import { RideStatus } from '../modules/rides/types.js';
import { latLngToH3Cell } from '../utils/geo.js';

export interface SeedDataPayload {
  users: Array<{
    id: string;
    phone: string;
    name: string;
    role: UserRole;
    rating: number;
    walletBalance: number;
    isActive: boolean;
  }>;
  vehicles: Array<{
    id: string;
    driverId: string;
    make: string;
    model: string;
    year: number;
    licensePlate: string;
    class: VehicleClass;
    color: string;
    isActive: boolean;
  }>;
  rides: Array<{
    id: string;
    riderId: string;
    driverId: string | null;
    status: RideStatus;
    pickupAddress: string;
    pickupLocation: { lat: number; lng: number };
    dropoffAddress: string;
    dropoffLocation: { lat: number; lng: number };
    fareBreakdown: {
      baseFare: number;
      perKmRate: number;
      distanceKm: number;
      distanceFare: number;
      perMinRate: number;
      durationMin: number;
      timeFare: number;
      surgeMultiplier: number;
      totalFare: number;
      currency: string;
    };
    otp: string;
    surgeMultiplier: number;
    estimatedDistanceKm: number;
    estimatedDurationMin: number;
    cancellationReason?: string | null;
    createdAt: Date;
    acceptedAt?: Date | null;
    arrivedAt?: Date | null;
    startedAt?: Date | null;
    completedAt?: Date | null;
  }>;
  telemetry: Array<{
    driverId: string;
    lat: number;
    lng: number;
    bearing: number;
    speed: number;
    h3Index: string;
    recordedAt: Date;
  }>;
}

export const SEED_DATA: SeedDataPayload = {
  users: [
    // Riders
    {
      id: 'a0000000-0000-4000-8000-000000000001',
      phone: '+14155552671',
      name: 'Alice Johnson',
      role: UserRole.RIDER,
      rating: 4.95,
      walletBalance: 150.0,
      isActive: true,
    },
    {
      id: 'a0000000-0000-4000-8000-000000000002',
      phone: '+14155558923',
      name: 'Bob Chen',
      role: UserRole.RIDER,
      rating: 4.88,
      walletBalance: 75.5,
      isActive: true,
    },
    {
      id: 'a0000000-0000-4000-8000-000000000003',
      phone: '+14155554312',
      name: 'Charlie Davis',
      role: UserRole.RIDER,
      rating: 5.0,
      walletBalance: 200.0,
      isActive: true,
    },
    // Drivers
    {
      id: 'd0000000-0000-4000-8000-000000000001',
      phone: '+14155551101',
      name: 'David Miller',
      role: UserRole.DRIVER,
      rating: 4.92,
      walletBalance: 320.0,
      isActive: true,
    },
    {
      id: 'd0000000-0000-4000-8000-000000000002',
      phone: '+14155551102',
      name: 'Elena Rostova',
      role: UserRole.DRIVER,
      rating: 4.98,
      walletBalance: 512.25,
      isActive: true,
    },
    {
      id: 'd0000000-0000-4000-8000-000000000003',
      phone: '+14155551103',
      name: 'Frank Wright',
      role: UserRole.DRIVER,
      rating: 4.85,
      walletBalance: 180.5,
      isActive: true,
    },
    {
      id: 'd0000000-0000-4000-8000-000000000004',
      phone: '+14155551104',
      name: 'Grace Hopper',
      role: UserRole.DRIVER,
      rating: 4.96,
      walletBalance: 640.0,
      isActive: true,
    },
    // Admin
    {
      id: 'f0000000-0000-4000-8000-000000000001',
      phone: '+14155550001',
      name: 'Operations Admin',
      role: UserRole.ADMIN,
      rating: 5.0,
      walletBalance: 0.0,
      isActive: true,
    },
  ],

  vehicles: [
    {
      id: 'v0000000-0000-4000-8000-000000000001',
      driverId: 'd0000000-0000-4000-8000-000000000001',
      make: 'Toyota',
      model: 'Camry Hybrid',
      year: 2024,
      licensePlate: '6XYZ789',
      class: VehicleClass.SEDAN,
      color: 'Midnight Black',
      isActive: true,
    },
    {
      id: 'v0000000-0000-4000-8000-000000000002',
      driverId: 'd0000000-0000-4000-8000-000000000002',
      make: 'Tesla',
      model: 'Model Y',
      year: 2024,
      licensePlate: '7ABC123',
      class: VehicleClass.SUV,
      color: 'Stealth Grey',
      isActive: true,
    },
    {
      id: 'v0000000-0000-4000-8000-000000000003',
      driverId: 'd0000000-0000-4000-8000-000000000003',
      make: 'Yamaha',
      model: 'MT-07',
      year: 2023,
      licensePlate: '8MOTO99',
      class: VehicleClass.BIKE,
      color: 'Cyan Storm',
      isActive: true,
    },
    {
      id: 'v0000000-0000-4000-8000-000000000004',
      driverId: 'd0000000-0000-4000-8000-000000000004',
      make: 'Honda',
      model: 'Accord',
      year: 2023,
      licensePlate: '9LMN456',
      class: VehicleClass.SEDAN,
      color: 'Pearl White',
      isActive: true,
    },
  ],

  rides: [
    // Completed Ride
    {
      id: 'r0000000-0000-4000-8000-000000000001',
      riderId: 'a0000000-0000-4000-8000-000000000001',
      driverId: 'd0000000-0000-4000-8000-000000000001',
      status: RideStatus.COMPLETED,
      pickupAddress: '555 California St, San Francisco, CA',
      pickupLocation: { lat: 37.7925, lng: -122.4042 },
      dropoffAddress: 'Pier 39, The Embarcadero, San Francisco, CA',
      dropoffLocation: { lat: 37.8087, lng: -122.4098 },
      fareBreakdown: {
        baseFare: 3.5,
        perKmRate: 1.8,
        distanceKm: 4.8,
        distanceFare: 8.64,
        perMinRate: 0.35,
        durationMin: 14.0,
        timeFare: 4.9,
        surgeMultiplier: 1.0,
        totalFare: 17.04,
        currency: 'USD',
      },
      otp: '4821',
      surgeMultiplier: 1.0,
      estimatedDistanceKm: 4.8,
      estimatedDurationMin: 14.0,
      createdAt: new Date('2026-11-06T08:30:00Z'),
      acceptedAt: new Date('2026-11-06T08:31:05Z'),
      arrivedAt: new Date('2026-11-06T08:34:20Z'),
      startedAt: new Date('2026-11-06T08:35:00Z'),
      completedAt: new Date('2026-11-06T08:49:00Z'),
    },
    // In-Transit Ride
    {
      id: 'r0000000-0000-4000-8000-000000000002',
      riderId: 'a0000000-0000-4000-8000-000000000002',
      driverId: 'd0000000-0000-4000-8000-000000000002',
      status: RideStatus.IN_TRANSIT,
      pickupAddress: 'Mission Dolores Park, San Francisco, CA',
      pickupLocation: { lat: 37.7596, lng: -122.4269 },
      dropoffAddress: 'San Francisco International Airport (SFO), CA',
      dropoffLocation: { lat: 37.6213, lng: -122.379 },
      fareBreakdown: {
        baseFare: 5.0,
        perKmRate: 2.2,
        distanceKm: 18.2,
        distanceFare: 40.04,
        perMinRate: 0.45,
        durationMin: 22.0,
        timeFare: 9.9,
        surgeMultiplier: 1.35,
        totalFare: 74.17,
        currency: 'USD',
      },
      otp: '7392',
      surgeMultiplier: 1.35,
      estimatedDistanceKm: 18.2,
      estimatedDurationMin: 22.0,
      createdAt: new Date('2026-11-06T11:00:00Z'),
      acceptedAt: new Date('2026-11-06T11:01:10Z'),
      arrivedAt: new Date('2026-11-06T11:05:30Z'),
      startedAt: new Date('2026-11-06T11:06:15Z'),
      completedAt: null,
    },
    // Searching Driver Ride
    {
      id: 'r0000000-0000-4000-8000-000000000003',
      riderId: 'a0000000-0000-4000-8000-000000000003',
      driverId: null,
      status: RideStatus.SEARCHING_DRIVER,
      pickupAddress: 'Oracle Park, 24 Willie Mays Plaza, San Francisco, CA',
      pickupLocation: { lat: 37.7786, lng: -122.3893 },
      dropoffAddress: 'Palace of Fine Arts, 3301 Lyon St, San Francisco, CA',
      dropoffLocation: { lat: 37.8029, lng: -122.4484 },
      fareBreakdown: {
        baseFare: 4.0,
        perKmRate: 1.9,
        distanceKm: 7.1,
        distanceFare: 13.49,
        perMinRate: 0.4,
        durationMin: 18.0,
        timeFare: 7.2,
        surgeMultiplier: 1.1,
        totalFare: 27.16,
        currency: 'USD',
      },
      otp: '1945',
      surgeMultiplier: 1.1,
      estimatedDistanceKm: 7.1,
      estimatedDurationMin: 18.0,
      createdAt: new Date('2026-11-06T11:15:00Z'),
      acceptedAt: null,
      arrivedAt: null,
      startedAt: null,
      completedAt: null,
    },
  ],

  telemetry: [
    // Driver 1 (David Miller) in Financial District
    {
      driverId: 'd0000000-0000-4000-8000-000000000001',
      lat: 37.793,
      lng: -122.4038,
      bearing: 45.0,
      speed: 28.5,
      h3Index: latLngToH3Cell(37.793, -122.4038, 8),
      recordedAt: new Date('2026-11-06T08:35:10Z'),
    },
    {
      driverId: 'd0000000-0000-4000-8000-000000000001',
      lat: 37.795,
      lng: -122.402,
      bearing: 42.0,
      speed: 32.0,
      h3Index: latLngToH3Cell(37.795, -122.402, 8),
      recordedAt: new Date('2026-11-06T08:36:00Z'),
    },
    // Driver 2 (Elena Rostova) En route to SFO on US-101 S
    {
      driverId: 'd0000000-0000-4000-8000-000000000002',
      lat: 37.7312,
      lng: -122.4055,
      bearing: 165.0,
      speed: 88.0, // Highway speed km/h
      h3Index: latLngToH3Cell(37.7312, -122.4055, 8),
      recordedAt: new Date('2026-11-06T11:10:00Z'),
    },
    {
      driverId: 'd0000000-0000-4000-8000-000000000002',
      lat: 37.6985,
      lng: -122.3981,
      bearing: 162.0,
      speed: 92.4,
      h3Index: latLngToH3Cell(37.6985, -122.3981, 8),
      recordedAt: new Date('2026-11-06T11:12:30Z'),
    },
    // Driver 4 (Grace Hopper) Available around SoMa
    {
      driverId: 'd0000000-0000-4000-8000-000000000004',
      lat: 37.781,
      lng: -122.3965,
      bearing: 210.0,
      speed: 15.2,
      h3Index: latLngToH3Cell(37.781, -122.3965, 8),
      recordedAt: new Date('2026-11-06T11:14:50Z'),
    },
  ],
};
