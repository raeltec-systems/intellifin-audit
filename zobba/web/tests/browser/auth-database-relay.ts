import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseProxy } from './database-proxy.ts';

if (!parentPort) throw new Error('The owned database relay requires a worker channel.');
const channel = parentPort;

async function start(): Promise<void> {
  const proxy = new DatabaseProxy(new URL(workerData.source));
  channel.on('message', async (action: unknown) => {
    try {
      if (action === 'disconnect') proxy.disconnect();
      else if (action === 'restore') proxy.restore();
      else if (action === 'close') await proxy.close();
      else throw new Error('Unknown relay action.');
      channel.postMessage(action);
      if (action === 'close') channel.close();
    } catch { channel.postMessage('failed'); }
  });
  const url = new URL(await proxy.start());
  channel.postMessage(Number(url.port));
}

void start().catch(() => { channel.postMessage('failed'); channel.close(); });
