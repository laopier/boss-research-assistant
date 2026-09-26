import { API_KEY_HEADER } from "./client-api-key";
import { GeneratorEnv } from "./goal-discovery/factory";

export const USER_API_KEY_MAX_LENGTH = 512;

/**
 * Uses a caller-supplied key for this request only. No key is written to disk,
 * cookies, the project ledger, or the process environment.
 */
export function generatorEnvForRequest(
  request: Request,
  base: GeneratorEnv = process.env as unknown as GeneratorEnv,
): GeneratorEnv {
  const key = request.headers.get(API_KEY_HEADER)?.trim() ?? "";
  if (!key) return base;
  if (key.length > USER_API_KEY_MAX_LENGTH || /[\r\n]/.test(key)) {
    throw new Error("INVALID_USER_API_KEY");
  }
  return {
    ...base,
    BOSS_GENERATOR: "llm",
    BOSS_API_KEY: key,
    DEEPSEEK_API_KEY: undefined,
  };
}
