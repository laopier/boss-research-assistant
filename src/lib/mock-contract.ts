import { BossContract, GenerateBossContractResponse } from "./contracts";
import fixture from "../../examples/waca-se-boss.json";

export function createMockContract(goal: string): GenerateBossContractResponse {
  const contract: BossContract = {
    ...(fixture as BossContract),
    rawGoal: goal,
  };

  return {
    contract,
    generation: "MOCK",
  };
}
