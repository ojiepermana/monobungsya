import type { Logger } from "#project/logger";
import type { AuthRepository } from "../../modules/auth/auth.repository";

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function startAuthCleanupWorker(
  repository: AuthRepository,
  logger: Logger,
): () => void {
  const run = async (): Promise<void> => {
    try {
      const result = await repository.cleanup();
      logger.info("auth.cleanup.completed", { ...result });
    } catch (error) {
      logger.error("auth.cleanup.failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const timer = setInterval(() => void run(), CLEANUP_INTERVAL_MS);
  timer.unref();

  return () => clearInterval(timer);
}
