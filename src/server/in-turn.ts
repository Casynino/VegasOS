/**
 * One job at a time per key, inside this server process: the next one starts when the one before it is over (a failing job never blocks the next).
 *
 * For small audit-trail writes that a crowd of requests can ask for at the same moment (a flood of failed sign-ins on one account, one session whose
 * work-as just ended, a loop of refused calls). Each such write is a database transaction that also needs a second connection (the settings): if a
 * crowd of them all waited INSIDE the database, holding the connections the first one needs, the pool would starve. Waiting here, before a
 * connection is taken, avoids that. The database's own lock still covers other processes.
 */
const queues = new Map<string, Promise<unknown>>();

export function inTurn<T>(key: string, job: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).then(job, job);
  const tail = run.catch(() => undefined);
  queues.set(key, tail);
  void tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return run;
}
