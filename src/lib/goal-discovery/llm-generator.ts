/**
 * LLM-backed Goal Discovery generator (OpenAI-compatible chat completions).
 *
 * Flow per docs/ai/goal-discovery.md "Retry and Fallback":
 *   attempt 1 — send system + user prompt, extract JSON, validate.
 *   attempt 2 (only if attempt 1 failed) — resend with the validation
 *              diagnostics appended so the model can repair its output.
 *   after that — throw GENERATION_FAILED. No partial objects, no fixture
 *              fallback, no silently weakened criteria.
 */
import { BossContractJson } from "./contract-types";
import { assertGoalValid, ContractGenerator, GenerationError, GenerateOptions } from "./generator";
import { buildGoalDiscoveryUserPrompt, GOAL_DISCOVERY_SYSTEM_PROMPT, PROMPT_VERSION } from "./prompt";
import {
  formatDiagnostics,
  validateContract,
  ValidationOptions,
} from "./validation";

export const DEFAULT_TIMEOUT_MS = 60_000;
export const MAX_ATTEMPTS = 2;

export interface LlmRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
}

export interface LlmResponse {
  content: string | null;
}

export interface LlmTransport {
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export interface OpenAICompatibleTransportOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class OpenAICompatibleTransport implements LlmTransport {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: OpenAICompatibleTransportOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const url = `${this.options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({
          model: this.options.model,
          messages: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: request.userPrompt },
          ],
          temperature: request.temperature ?? 0.2,
          response_format: { type: "json_object" },
          stream: false,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new GenerationError(
        "TRANSPORT_ERROR",
        `request to ${url} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new GenerationError(
        "TRANSPORT_ERROR",
        `HTTP ${response.status} from ${url}: ${body.slice(0, 300)}`,
      );
    }

    const payload = (await response.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: string | null } }> }
      | null;
    const content = payload?.choices?.[0]?.message?.content ?? null;
    if (content === null) {
      throw new GenerationError("TRANSPORT_ERROR", "response contained no message content");
    }
    return { content };
  }
}

/**
 * Extract the first complete JSON object from a model reply.
 * Handles: raw JSON, ```json fences, bare ``` fences, and JSON preceded by
 * prose. Returns the parsed object or null when nothing parseable exists.
 */
export function extractJson(text: string): unknown | null {
  const trimmed = text.trim();

  // 1. Whole reply is the JSON object.
  const direct = tryParse(trimmed);
  if (direct !== null) return direct;

  // 2. Fenced block (```json ... ``` or ``` ... ```).
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const fenced = tryParse(fence[1].trim());
    if (fenced !== null) return fenced;
  }

  // 3. First balanced {...} object anywhere in the reply.
  const start = trimmed.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        if (inString) escaped = true;
        continue;
      }
      if (ch === '"') inString = !inString;
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const candidate = tryParse(trimmed.slice(start, i + 1));
          if (candidate !== null) return candidate;
        }
      }
    }
  }

  return null;
}

function tryParse(text: string): unknown | null {
  if (!text.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

export interface LLMContractGeneratorOptions {
  transport: LlmTransport;
  validationOptions?: ValidationOptions;
}

export class LLMContractGenerator implements ContractGenerator {
  constructor(private readonly options: LLMContractGeneratorOptions) {}

  async generate(goal: string, _options?: GenerateOptions): Promise<BossContractJson> {
    const trimmed = assertGoalValid(goal);
    let lastDiagnostics: string[] = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const userPrompt =
        attempt === 1
          ? buildGoalDiscoveryUserPrompt(trimmed)
          : buildRepairPrompt(trimmed, lastDiagnostics);

      const response = await this.options.transport.complete({
        systemPrompt: GOAL_DISCOVERY_SYSTEM_PROMPT,
        userPrompt,
      });

      const doc = response.content === null ? null : extractJson(response.content);
      if (doc === null) {
        lastDiagnostics = ["The previous reply was not a single JSON object. Reply with ONE complete JSON object and nothing else."];
        continue;
      }

      const outcome = validateContract(trimmed, doc, this.options.validationOptions);
      if (outcome.outcome === "CONTRACT") {
        return outcome.contract;
      }
      lastDiagnostics = [
        formatDiagnostics(outcome.diagnostics),
        "Return ONE complete replacement JSON object. Preserve the user's intent; do not remove required criteria to pass validation.",
      ];
    }

    throw new GenerationError(
      "GENERATION_FAILED",
      `model output failed validation after ${MAX_ATTEMPTS} attempts (prompt ${PROMPT_VERSION})`,
      lastDiagnostics,
    );
  }
}

function buildRepairPrompt(goal: string, diagnostics: string[]): string {
  return JSON.stringify({
    schemaVersion: "boss-contract.v0",
    goal,
    previousAttemptInvalid: true,
    validationErrors: diagnostics.join("\n").slice(0, 2000),
    instruction:
      "Your previous reply failed validation. Return ONE complete replacement JSON object that fixes every error. Preserve the user's intent; do not remove required criteria merely to pass validation.",
  });
}
