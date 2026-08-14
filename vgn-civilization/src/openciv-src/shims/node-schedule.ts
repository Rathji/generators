// Replacement for the npm `node-schedule` package. OpenCiv only schedules a 1-second
// recurring turn timer ("* * * * * *"), so a setInterval is a faithful substitute.
const jobs: number[] = [];

export class Job {
  public cancel() {}
}

export function scheduleJob(expr: string, cb: () => void): Job {
  const id = window.setInterval(cb, 1000);
  jobs.push(id);
  return new Job();
}

export function gracefulShutdown() {
  for (const id of jobs) window.clearInterval(id);
  jobs.length = 0;
}

