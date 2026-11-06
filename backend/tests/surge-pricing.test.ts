import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryRedisClient } from '../src/services/redis/in-memory-redis.js';
import { PricingService } from '../src/services/pricing/pricing.service.js';
import { DynamicSurgeAgent } from '../src/agents/surge/surge.agent.js';

describe('Phase 4 - Dynamic Surge Pricing & Agent Layer', () => {
  let redis: InMemoryRedisClient;
  let pricingService: PricingService;
  let surgeAgent: DynamicSurgeAgent;

  beforeEach(() => {
    redis = new InMemoryRedisClient();
    pricingService = new PricingService(redis);
    surgeAgent = new DynamicSurgeAgent(pricingService);
  });

  const testH3Cell = '8828308281fffff';

  describe('Supply-Demand Elasticity Mathematical Formula', () => {
    it('should return base multiplier 1.00 when supply meets or exceeds demand (D <= S)', () => {
      // D = 10, S = 10 -> M = 1.00
      expect(pricingService.calculateRuleBasedSurge(10, 10)).toBe(1.0);
      // D = 5, S = 15 -> M = 1.00
      expect(pricingService.calculateRuleBasedSurge(5, 15)).toBe(1.0);
      // D = 0, S = 20 -> M = 1.00
      expect(pricingService.calculateRuleBasedSurge(0, 20)).toBe(1.0);
    });

    it('should scale dynamically under moderate deficit', () => {
      // D = 15, S = 5
      // Deficit = 10, S + epsilon = 6. Elasticity = 10/6 = 1.6667
      // M = 1.0 + 0.5 * 1.6667 = 1.83
      const surge = pricingService.calculateRuleBasedSurge(15, 5);
      expect(surge).toBe(1.83);
    });

    it('should cap strictly at 3.50 ceiling under extreme spatial deficit', () => {
      // D = 100, S = 1 -> extreme deficit
      const surge = pricingService.calculateRuleBasedSurge(100, 1);
      expect(surge).toBe(3.5);
    });

    it('should apply weather multipliers and enforce ceiling', () => {
      // Moderate deficit with Rain (1.15x)
      const baseSurge = pricingService.calculateRuleBasedSurge(15, 5, 1.0);
      const rainSurge = pricingService.calculateRuleBasedSurge(15, 5, 1.15);
      expect(rainSurge).toBeGreaterThan(baseSurge);
      expect(rainSurge).toBeLessThanOrEqual(3.5);

      // Severe deficit with Storm (1.45x) capped at 3.50
      const stormSurge = pricingService.calculateRuleBasedSurge(50, 2, 1.45);
      expect(stormSurge).toBe(3.5);
    });
  });

  describe('Dynamic Surge Agent & Fallback Behaviors', () => {
    it('should parse valid AI Agent structured response', async () => {
      // Inject mock LLM provider returning structured JSON
      surgeAgent.setLlmProvider(async () => {
        return JSON.stringify({
          surgeMultiplier: 2.15,
          confidence: 0.92,
          justification: 'High evening commute demand around stadium with rain',
          factors: {
            demand: 35,
            supply: 10,
            deficit: 25,
            weatherCondition: 'RAIN',
            weatherMultiplier: 1.15,
            eventSignal: true,
          },
        });
      });

      const recommendation = await surgeAgent.evaluateSurge(testH3Cell, 35, 10, 'RAIN', true);
      expect(recommendation.source).toBe('AI_AGENT');
      expect(recommendation.surgeMultiplier).toBe(2.15);
      expect(recommendation.confidence).toBe(0.92);

      // Verify cached in Redis
      const cached = await pricingService.getCachedSurge(testH3Cell);
      expect(cached).toBe(2.15);
    });

    it('should automatically trigger deterministic rule-based fallback on LLM failure', async () => {
      // Simulate broken LLM returning invalid JSON
      surgeAgent.setLlmProvider(async () => {
        return 'Internal LLM Error: 500 Service Unavailable';
      });

      const recommendation = await surgeAgent.evaluateSurge(testH3Cell, 15, 5, 'CLEAR', false);
      expect(recommendation.source).toBe('RULE_BASED_FALLBACK');
      expect(recommendation.surgeMultiplier).toBe(1.83);
      expect(recommendation.justification).toContain('Rule-based elasticity');

      // Verify cached in Redis
      const cached = await pricingService.getCachedSurge(testH3Cell);
      expect(cached).toBe(1.83);
    });

    it('should automatically trigger fallback on LLM timeout (>800ms)', async () => {
      // Simulate hanging LLM (950ms latency)
      surgeAgent.setLlmProvider(async () => {
        await new Promise((r) => setTimeout(r, 950));
        return JSON.stringify({ surgeMultiplier: 3.0 });
      });

      const recommendation = await surgeAgent.evaluateSurge(testH3Cell, 20, 5);
      expect(recommendation.source).toBe('RULE_BASED_FALLBACK');
      expect(recommendation.surgeMultiplier).toBeGreaterThanOrEqual(1.0);
    });
  });
});
