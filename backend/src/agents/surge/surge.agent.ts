import { PricingService } from '../../services/pricing/pricing.service.js';
import {
  SurgeRecommendation,
  SurgeRecommendationSchema,
  WeatherCondition,
} from '../../services/pricing/pricing.types.js';

export interface LlmCompletionFunction {
  (prompt: string, timeoutMs: number): Promise<string>;
}

export class DynamicSurgeAgent {
  private llmCaller?: LlmCompletionFunction;

  constructor(
    private pricingService: PricingService,
    llmCaller?: LlmCompletionFunction
  ) {
    this.llmCaller = llmCaller;
  }

  /**
   * Sets custom LLM provider function
   */
  setLlmProvider(caller: LlmCompletionFunction): void {
    this.llmCaller = caller;
  }

  /**
   * Evaluates surge pricing for an H3 cell:
   * 1. Attempts AI agent structured reasoning within 800ms timeout
   * 2. If agent times out (>800ms), fails, or yields invalid output, automatically falls back to deterministic rule-based formula.
   */
  async evaluateSurge(
    h3Cell: string,
    demand: number,
    supply: number,
    weather: WeatherCondition = 'CLEAR',
    eventSignal = false
  ): Promise<SurgeRecommendation> {
    const deficit = demand - supply;
    const weatherMultipliers: Record<WeatherCondition, number> = {
      CLEAR: 1.0,
      RAIN: 1.15,
      SNOW: 1.3,
      STORM: 1.45,
    };
    const weatherMult = weatherMultipliers[weather] || 1.0;

    // 1. Attempt AI Agent generation if provider is available
    if (this.llmCaller) {
      try {
        const prompt = this.buildPrompt(h3Cell, demand, supply, deficit, weather, eventSignal);
        // Strict 800ms timeout race
        const responseJson = await this.executeWithTimeout(this.llmCaller(prompt, 800), 800);
        const parsed = JSON.parse(responseJson);

        // Validate strictly with Zod schema
        const validated = SurgeRecommendationSchema.parse({
          ...parsed,
          h3Cell,
          generatedAt: Date.now(),
          source: 'AI_AGENT',
        });

        // Cache recommendation in Redis
        await this.pricingService.setCachedSurge(h3Cell, validated.surgeMultiplier);
        return validated;
      } catch (error) {
        // Log defensive fallback activation
        console.warn(`[DynamicSurgeAgent] AI inference failed or timed out. Falling back to rule-based formula:`, error);
      }
    }

    // 2. Deterministic Rule-Based Fallback
    const ruleMultiplier = this.pricingService.calculateRuleBasedSurge(demand, supply, weatherMult);
    const justification = `Rule-based elasticity: demand=${demand}, supply=${supply}, deficit=${deficit}, weather=${weather} (${weatherMult}x)`;

    const fallbackRecommendation: SurgeRecommendation = {
      h3Cell,
      surgeMultiplier: ruleMultiplier,
      confidence: 1.0,
      justification,
      factors: {
        demand,
        supply,
        deficit,
        weatherCondition: weather,
        weatherMultiplier: weatherMult,
        eventSignal,
      },
      generatedAt: Date.now(),
      source: 'RULE_BASED_FALLBACK',
    };

    // Cache fallback multiplier in Redis
    await this.pricingService.setCachedSurge(h3Cell, ruleMultiplier);
    return fallbackRecommendation;
  }

  private buildPrompt(
    h3Cell: string,
    demand: number,
    supply: number,
    deficit: number,
    weather: WeatherCondition,
    eventSignal: boolean
  ): string {
    return `
You are the Dynamic Surge Pricing AI Agent for an on-demand ride-hailing platform.
Evaluate real-time supply and demand elasticity for H3 cell ${h3Cell}.

Current Context:
- Unfulfilled Requests (Demand D): ${demand}
- Active Available Drivers (Supply S): ${supply}
- Spatial Deficit (D - S): ${deficit}
- Weather Condition: ${weather}
- High-Density Event Detected: ${eventSignal}

Instructions:
1. Recommend an optimal surge multiplier between 1.00 and 3.50.
2. Provide a clear justification for riders and drivers.
3. Return ONLY a valid JSON object matching this structure:
{
  "surgeMultiplier": 1.75,
  "confidence": 0.95,
  "justification": "Moderate supply deficit in cell with active rain",
  "factors": {
    "demand": ${demand},
    "supply": ${supply},
    "deficit": ${deficit},
    "weatherCondition": "${weather}",
    "weatherMultiplier": 1.15,
    "eventSignal": ${eventSignal}
  }
}
`.trim();
  }

  private async executeWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`LLM inference timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timer!);
    }
  }
}
