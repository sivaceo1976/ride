import { Coordinate } from '../../modules/rides/types.js';
import { calculateBearing, calculateHaversineDistanceKm } from '../../utils/geo.js';

export interface RideCandidateInput {
  rideId: string;
  pickupLocation: Coordinate;
}

export interface DriverCandidateInput {
  driverId: string;
  location: Coordinate;
  speed: number;
  rating: number;
  bearing: number;
}

export interface MatchAssignment {
  rideId: string;
  driverId: string;
  cost: number;
  etaMinutes: number;
}

export class BipartiteDispatchMatcher {
  /**
   * Computes the cost C_ij between Ride i and Driver j:
   * Cost = w1 * ETA + w2 * (5.0 - rating) + w3 * bearingAlignment
   */
  calculateEdgeCost(
    ride: RideCandidateInput,
    driver: DriverCandidateInput
  ): { cost: number; etaMinutes: number } {
    const distKm = calculateHaversineDistanceKm(driver.location, ride.pickupLocation);
    const effectiveSpeed = driver.speed > 10 ? driver.speed : 30;
    const etaMinutes = (distKm / effectiveSpeed) * 60;

    const ratingPenalty = Math.max(0, 5.0 - driver.rating);

    const bearingToPickup = calculateBearing(driver.location, ride.pickupLocation);
    let angleDiff = Math.abs(driver.bearing - bearingToPickup) % 360;
    if (angleDiff > 180) {
      angleDiff = 360 - angleDiff;
    }
    const bearingAlignment = angleDiff / 180;

    const w1 = 0.5;
    const w2 = 0.3;
    const w3 = 0.2;

    const cost = w1 * etaMinutes + w2 * ratingPenalty + w3 * bearingAlignment;
    return {
      cost: Math.round(cost * 1000) / 1000,
      etaMinutes: Math.round(etaMinutes * 10) / 10,
    };
  }

  /**
   * Builds the cost matrix C_ij for rides and drivers.
   */
  buildCostMatrix(
    rides: RideCandidateInput[],
    drivers: DriverCandidateInput[]
  ): number[][] {
    const matrix: number[][] = [];
    for (let i = 0; i < rides.length; i++) {
      matrix[i] = [];
      for (let j = 0; j < drivers.length; j++) {
        matrix[i][j] = this.calculateEdgeCost(rides[i], drivers[j]).cost;
      }
    }
    return matrix;
  }

  /**
   * Solves minimum weight bipartite matching using Hungarian Algorithm (Kuhn-Munkres).
   * Minimizes total platform pickup latency across active requests.
   */
  solveHungarian(costMatrix: number[][]): number[] {
    const nRides = costMatrix.length;
    if (nRides === 0) return [];
    const nDrivers = costMatrix[0].length;
    if (nDrivers === 0) return [];

    const dim = Math.max(nRides, nDrivers);
    const INF = 1e9;

    // Pad matrix to square dim x dim
    const cost: number[][] = [];
    for (let i = 0; i < dim; i++) {
      cost[i] = [];
      for (let j = 0; j < dim; j++) {
        if (i < nRides && j < nDrivers) {
          cost[i][j] = costMatrix[i][j];
        } else {
          cost[i][j] = INF; // Dummy padding
        }
      }
    }

    // Dual variables (potentials)
    const u = new Array(dim + 1).fill(0);
    const v = new Array(dim + 1).fill(0);
    const p = new Array(dim + 1).fill(0);
    const way = new Array(dim + 1).fill(0);

    for (let i = 1; i <= dim; i++) {
      p[0] = i;
      let j0 = 0;
      const minv = new Array(dim + 1).fill(INF);
      const used = new Array(dim + 1).fill(false);

      do {
        used[j0] = true;
        const i0 = p[j0];
        let delta = INF;
        let j1 = 0;

        for (let j = 1; j <= dim; j++) {
          if (!used[j]) {
            const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
            if (cur < minv[j]) {
              minv[j] = cur;
              way[j] = j0;
            }
            if (minv[j] < delta) {
              delta = minv[j];
              j1 = j;
            }
          }
        }

        for (let j = 0; j <= dim; j++) {
          if (used[j]) {
            u[p[j]] += delta;
            v[j] -= delta;
          } else {
            minv[j] -= delta;
          }
        }

        j0 = j1;
      } while (p[j0] !== 0);

      do {
        const j1 = way[j0];
        p[j0] = p[j1];
        j0 = j1;
      } while (j0 !== 0);
    }

    // Extract assignments: result[i] = driver index matched to ride i
    const matching: number[] = new Array(nRides).fill(-1);
    for (let j = 1; j <= dim; j++) {
      const i = p[j];
      if (i > 0 && i <= nRides && j <= nDrivers && cost[i - 1][j - 1] < INF / 2) {
        matching[i - 1] = j - 1;
      }
    }

    return matching;
  }

  /**
   * Executes optimal bipartite matching for batches of competing rides and nearby drivers.
   */
  matchBatch(
    rides: RideCandidateInput[],
    drivers: DriverCandidateInput[]
  ): {
    assignments: MatchAssignment[];
    totalCost: number;
    unmatchedRides: string[];
  } {
    if (rides.length === 0 || drivers.length === 0) {
      return { assignments: [], totalCost: 0, unmatchedRides: rides.map((r) => r.rideId) };
    }

    const costMatrix = this.buildCostMatrix(rides, drivers);
    const matching = this.solveHungarian(costMatrix);

    const assignments: MatchAssignment[] = [];
    let totalCost = 0;
    const unmatchedRides: string[] = [];

    for (let i = 0; i < rides.length; i++) {
      const driverIdx = matching[i];
      if (driverIdx !== -1 && driverIdx !== undefined) {
        const ride = rides[i];
        const driver = drivers[driverIdx];
        const { cost, etaMinutes } = this.calculateEdgeCost(ride, driver);

        assignments.push({
          rideId: ride.rideId,
          driverId: driver.driverId,
          cost,
          etaMinutes,
        });
        totalCost += cost;
      } else {
        unmatchedRides.push(rides[i].rideId);
      }
    }

    return {
      assignments,
      totalCost: Math.round(totalCost * 1000) / 1000,
      unmatchedRides,
    };
  }

  /**
   * Baseline Greedy Matching (for comparison and benchmarks):
   * Sequentially assigns each ride to its closest remaining driver.
   */
  matchGreedy(
    rides: RideCandidateInput[],
    drivers: DriverCandidateInput[]
  ): {
    assignments: MatchAssignment[];
    totalCost: number;
  } {
    const availableDriverIndices = new Set(drivers.map((_, i) => i));
    const assignments: MatchAssignment[] = [];
    let totalCost = 0;

    for (const ride of rides) {
      let bestDriverIdx = -1;
      let minCost = Infinity;
      let bestEta = 0;

      for (const dIdx of availableDriverIndices) {
        const { cost, etaMinutes } = this.calculateEdgeCost(ride, drivers[dIdx]);
        if (cost < minCost) {
          minCost = cost;
          bestDriverIdx = dIdx;
          bestEta = etaMinutes;
        }
      }

      if (bestDriverIdx !== -1) {
        availableDriverIndices.delete(bestDriverIdx);
        assignments.push({
          rideId: ride.rideId,
          driverId: drivers[bestDriverIdx].driverId,
          cost: minCost,
          etaMinutes: bestEta,
        });
        totalCost += minCost;
      }
    }

    return {
      assignments,
      totalCost: Math.round(totalCost * 1000) / 1000,
    };
  }
}
