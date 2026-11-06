import { describe, it, expect } from 'vitest';
import {
  BipartiteDispatchMatcher,
  RideCandidateInput,
  DriverCandidateInput,
} from '../src/agents/dispatch/bipartite.matcher.js';

describe('Phase 4 - Advanced Dispatch: Global Bipartite / Hungarian Optimization', () => {
  const matcher = new BipartiteDispatchMatcher();

  it('should outperform naive greedy matching by minimizing global platform cost / ETA', () => {
    // Setup classic bipartite assignment scenario where greedy choice creates a sub-optimal trap:
    // Ride 1 is at (37.77, -122.42)
    // Ride 2 is at (37.85, -122.42) (Far north)
    //
    // Driver 1 is at (37.772, -122.42) -> Very close to Ride 1 (~0.22 km), but also the ONLY driver anywhere near Ride 2 (~8.6 km)
    // Driver 2 is at (37.773, -122.42) -> Also close to Ride 1 (~0.33 km), but 8.8 km from Ride 2
    // Driver 3 is at (37.771, -122.42) -> Close to Ride 1 (~0.11 km)
    //
    // More distinct setup:
    // Ride 1 is at Market St (37.775, -122.419)
    // Ride 2 is at Marina (37.803, -122.436)
    //
    // Driver A is at (37.776, -122.420) -> Distance to R1 = 0.14 km, Distance to R2 = 3.3 km
    // Driver B is at (37.774, -122.418) -> Distance to R1 = 0.15 km, Distance to R2 = 3.6 km

    // Direct cost matrix benchmark:
    // R1: D1=2.0, D2=2.5
    // R2: D1=2.2, D2=8.0
    // Greedy on R1 picks D1 (cost 2.0). Then R2 is forced to take D2 (cost 8.0) -> Total Greedy = 10.0!
    // Hungarian assigns R1 -> D2 (cost 2.5), R2 -> D1 (cost 2.2) -> Total Hungarian = 4.7! (More than 50% faster!)

    const rides: RideCandidateInput[] = [
      {
        rideId: 'ride-1',
        pickupLocation: { lat: 37.775, lng: -122.419 },
      },
      {
        rideId: 'ride-2',
        pickupLocation: { lat: 37.820, lng: -122.419 }, // Further north
      },
    ];

    const drivers: DriverCandidateInput[] = [
      {
        // Driver 1 is in between both rides
        driverId: 'driver-1',
        location: { lat: 37.776, lng: -122.419 }, // Distance to R1 = ~0.11km, Distance to R2 = ~4.89km
        speed: 30,
        rating: 5.0,
        bearing: 0,
      },
      {
        // Driver 2 is slightly further south from R1, very far from R2
        driverId: 'driver-2',
        location: { lat: 37.773, lng: -122.419 }, // Distance to R1 = ~0.22km, Distance to R2 = ~5.22km
        speed: 30,
        rating: 5.0,
        bearing: 0,
      },
    ];

    const greedy = matcher.matchGreedy(rides, drivers);
    const hungarian = matcher.matchBatch(rides, drivers);

    expect(hungarian.assignments.length).toBe(2);
    expect(greedy.assignments.length).toBe(2);

    // Hungarian global cost must be strictly less than or equal to greedy
    expect(hungarian.totalCost).toBeLessThanOrEqual(greedy.totalCost);
  });

  it('should optimally solve custom asymmetric assignment matrices', () => {
    // 3 Rides, 4 Drivers
    const customCostMatrix = [
      [2, 9, 3, 7],
      [6, 3, 5, 4],
      [8, 7, 2, 6],
    ];

    const matching = matcher.solveHungarian(customCostMatrix);

    expect(matching.length).toBe(3);
    // Optimal matching: R0 -> D0 (cost 2), R1 -> D1 (cost 3), R2 -> D2 (cost 2)
    // Sum = 2 + 3 + 2 = 7
    expect(matching[0]).toBe(0);
    expect(matching[1]).toBe(1);
    expect(matching[2]).toBe(2);

    const totalCost =
      customCostMatrix[0][matching[0]] +
      customCostMatrix[1][matching[1]] +
      customCostMatrix[2][matching[2]];
    expect(totalCost).toBe(7);
  });
});
