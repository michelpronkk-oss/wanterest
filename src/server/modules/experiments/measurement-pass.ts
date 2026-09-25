import { createSupabaseServiceClient } from "../../providers/supabase/service";
import { AppError } from "../../lib/errors";
import { ExperimentMeasurementService } from "./experiment-measurement.service";
import { SupabaseMeasurementRepository } from "./measurement.repository";
import { EXPERIMENT_MEASUREMENT_PASS_LIMIT } from "./measurement.schemas";

/**
 * Daily Layer 11 measurement pass wiring (Trigger `experiment-measurement-pass`).
 * It is the single automatic writer: at most 50 due experiments per run, no
 * provider or LLM calls, and it deliberately ignores EXPERIMENT_MEASUREMENT_ENABLED
 * because draining must continue after a rollback (gaps become inconclusive).
 */
export async function runExperimentMeasurementPass(now: () => Date = () => new Date()) {
  const service = new ExperimentMeasurementService({
    repository: new SupabaseMeasurementRepository(createSupabaseServiceClient()),
    measurementEnabled: false, // new work only; the pass never creates new work
    revalidateAction: async () => { throw new AppError("FORBIDDEN", "The measurement pass never creates experiments."); },
    now,
  });
  return service.runMeasurementPass(EXPERIMENT_MEASUREMENT_PASS_LIMIT);
}
