import { z } from 'zod';

export const WeatherConditionSchema = z.enum(['CLEAR', 'RAIN', 'SNOW', 'STORM']);

export const SurgeFactorsSchema = z.object({
  demand: z.number().int().min(0),
  supply: z.number().int().min(0),
  deficit: z.number().int(),
  weatherCondition: WeatherConditionSchema.default('CLEAR'),
  weatherMultiplier: z.number().min(1.0).max(1.5).default(1.0),
  eventSignal: z.boolean().default(false),
});

export const SurgeRecommendationSchema = z.object({
  h3Cell: z.string().regex(/^[0-9a-f]{15}$/i, 'Invalid 15-character H3 hex cell'),
  surgeMultiplier: z
    .number()
    .min(1.0, 'Surge multiplier floor is 1.00')
    .max(3.5, 'Surge multiplier ceiling is 3.50')
    .transform((val) => Math.round(val * 100) / 100),
  confidence: z.number().min(0.0).max(1.0),
  justification: z.string().min(5),
  factors: SurgeFactorsSchema,
  generatedAt: z.number(),
  source: z.enum(['AI_AGENT', 'RULE_BASED_FALLBACK']),
});

export type WeatherCondition = z.infer<typeof WeatherConditionSchema>;
export type SurgeFactors = z.infer<typeof SurgeFactorsSchema>;
export type SurgeRecommendation = z.infer<typeof SurgeRecommendationSchema>;
