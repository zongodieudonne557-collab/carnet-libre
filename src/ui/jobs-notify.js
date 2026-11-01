// Prévient la personne quand une génération (en tâche de fond) se termine, même si elle a changé d'écran.
import { toast } from './dom.js';
import { reportAIError } from './ai-gate.js';
import { currentPath, navigate } from './router.js';
import { listJobs, subscribeJobs } from './store.js';

const told = new WeakSet();

export function watchJobs() {
  return subscribeJobs(() => {
    for (const job of listJobs()) {
      if (job.status === 'running' || told.has(job)) continue;
      told.add(job);
      if (job.status === 'cancelled') continue;
      if (job.status === 'error') {
        console.error(job.error);
        reportAIError(job.error);
        continue;
      }
      const to = job.result?.href;
      const here = to && currentPath() === to;
      toast(job.result?.message || `${job.label} : terminé.`, {
        kind: 'ok',
        action: to && !here ? { label: 'Voir', onClick: () => navigate(to) } : undefined,
      });
    }
  });
}
