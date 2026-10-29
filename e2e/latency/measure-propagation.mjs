// Measures how long a diagram change takes to reach the other collaborators, at the protocol level:
// from the moment one client publishes a patch to the moment each other client receives the merged
// state. The editor's 1.5 s autosave debounce is NOT included; the browser-level measurement in
// tests/latency.spec.ts covers what a user perceives.
//
//   ERD_BASE_URL=http://localhost:4200 SAMPLES=100 RECEIVERS=1,4,9 node latency/measure-propagation.mjs
//
// One sender and R receivers join the same project; for each sample the sender renames the same
// table, so the payload size stays constant, and every receiver timestamps the broadcast with the
// same monotonic clock as the sender (they all live in this process).
import { Client } from '@stomp/stompjs';
import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';

const BASE = process.env.ERD_BASE_URL ?? 'http://localhost:4200';
const WS_PATH = process.env.ERD_WS_PATH ?? '/api/ws';
const SAMPLES = Number(process.env.SAMPLES ?? 100);
const RECEIVERS = (process.env.RECEIVERS ?? '1,4,9').split(',').map(Number);
const PAUSE_MS = Number(process.env.PAUSE_MS ?? 200);
const WARMUP = Number(process.env.WARMUP ?? 5);
const PASSWORD = 'Senha@123';

async function api(method, path, jar, body) {
  const response = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(jar.cookie ? { Cookie: jar.cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const token = (response.headers.getSetCookie?.() ?? []).find(c => c.startsWith('erd-token='));
  if (token) jar.cookie = token.split(';')[0];
  // Registration answers with plain text, the other endpoints with JSON.
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { status: response.status, json };
}

async function member(label, run) {
  const email = `${label}.${run}@latency.local`;
  await api('POST', '/api/user', {}, { firstName: label, lastName: 'Latency', email, password: PASSWORD, role: 'USER' });
  const jar = {};
  const login = await api('POST', '/api/auth/login', jar, { email, password: PASSWORD });
  if (login.status !== 200) throw new Error(`login ${email}: ${login.status}`);
  return { email, jar };
}

function connect(jar) {
  const url = BASE.replace(/^http/, 'ws') + WS_PATH + '/websocket';
  return new Promise((resolve, reject) => {
    const client = new Client({
      webSocketFactory: () => new WebSocket(url, { headers: { Cookie: jar.cookie } }),
      reconnectDelay: 0,
      heartbeatIncoming: 0,
      heartbeatOutgoing: 0,
      onConnect: () => resolve(client),
      onStompError: frame => reject(new Error(frame.headers.message)),
      onWebSocketError: () => reject(new Error('WebSocket error'))
    });
    client.activate();
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = q => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  const std = Math.sqrt(sorted.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (sorted.length - 1));
  const round = v => Math.round(v * 10) / 10;
  return {
    n: sorted.length, mean: round(mean), std: round(std), min: round(sorted[0]),
    median: round(pick(0.5)), p95: round(pick(0.95)), p99: round(pick(0.99)), max: round(sorted.at(-1))
  };
}

async function measure(receiverCount, run) {
  const sender = await member(`sender${receiverCount}`, run);
  const receivers = [];
  for (let r = 0; r < receiverCount; r++) receivers.push(await member(`receiver${receiverCount}x${r}`, run));

  const project = await api('POST', '/api/project', sender.jar, { name: `latency ${receiverCount} ${run}`, description: 'latency', userEmail: sender.email });
  const projectId = project.json.id;
  for (const receiver of receivers) {
    await api('POST', '/api/project/team-member', sender.jar, { userEmail: receiver.email, projectId, roleProjectEnum: 'EDITOR' });
  }

  const senderClient = await connect(sender.jar);
  const pending = new Map(); // sample key -> { sentAt, arrivals: [] }
  const clients = [];
  for (const receiver of receivers) {
    const client = await connect(receiver.jar);
    client.subscribe(`/topic/diagram/${projectId}`, message => {
      const receivedAt = performance.now();
      const key = JSON.parse(message.body).nodeDataArray?.[0]?.key;
      pending.get(key)?.arrivals.push(receivedAt);
    });
    clients.push(client);
  }
  await sleep(1000);

  const tableId = randomUUID();
  const latencies = [];
  let lost = 0;
  for (let i = 0; i < WARMUP + SAMPLES; i++) {
    const key = `sample_${i}`;
    const entry = { sentAt: performance.now(), arrivals: [] };
    pending.set(key, entry);
    senderClient.publish({
      destination: '/app/patch',
      body: JSON.stringify({ projectId, upsertNodes: [{ id: tableId, key, items: [], location: { x: '0', y: '0' } }] })
    });
    const deadline = performance.now() + 5000;
    while (entry.arrivals.length < receiverCount && performance.now() < deadline) await sleep(2);
    if (i >= WARMUP) {
      latencies.push(...entry.arrivals.map(at => at - entry.sentAt));
      lost += receiverCount - entry.arrivals.length;
    }
    pending.delete(key);
    await sleep(PAUSE_MS);
  }

  await Promise.all([senderClient, ...clients].map(client => client.deactivate()));
  return { users: receiverCount + 1, receivers: receiverCount, samples: SAMPLES, lost, summary: summarize(latencies), raw: latencies };
}

const run = Date.now();
const results = [];
for (const receiverCount of RECEIVERS) {
  const result = await measure(receiverCount, run);
  results.push(result);
  console.log(`${result.users} users: ${JSON.stringify(result.summary)} lost=${result.lost}`);
}

const report = {
  baseUrl: BASE,
  measuredAt: new Date().toISOString(),
  node: process.version,
  host: `${os.type()} ${os.release()} ${os.cpus()[0]?.model} x${os.cpus().length}`,
  samplesPerGroup: SAMPLES,
  warmup: WARMUP,
  pauseMs: PAUSE_MS,
  results
};
mkdirSync('results', { recursive: true });
const file = `results/latency-${new URL(BASE).hostname}-${run}.json`;
writeFileSync(file, JSON.stringify(report, null, 2));
console.log(`report: ${file}`);
process.exit(0);
