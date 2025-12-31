// Simple in-memory store (use Redis in production)
const jobs = new Map();

export function createJob(jobId, data) {
  const job = {
    id: jobId,
    status: 'queued',
    data,
    createdAt: new Date().toISOString(),
    progress: 0
  };
  
  jobs.set(jobId, job);
  return job;
}

export function getJob(jobId) {
  return jobs.get(jobId);
}

export function updateJobStatus(jobId, updates) {
  const job = jobs.get(jobId);
  if (job) {
    Object.assign(job, updates, {
      updatedAt: new Date().toISOString()
    });
    jobs.set(jobId, job);
  }
  return job;
}

export function deleteJob(jobId) {
  return jobs.delete(jobId);
}

// Cleanup old jobs (run periodically)
export function cleanupOldJobs(maxAgeHours = 24) {
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
  
  for (const [jobId, job] of jobs.entries()) {
    const jobDate = new Date(job.createdAt);
    if (jobDate < cutoff) {
      jobs.delete(jobId);
    }
  }
}