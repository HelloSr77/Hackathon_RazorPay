import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Locate python executable (prefer workspace venv if present)
function getPythonExecutable() {
  const venvPython = path.resolve(__dirname, '..', 'venv', 'Scripts', 'python.exe');
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }
  return 'python';
}

const SCRIPT_PATH = path.resolve(__dirname, '..', 'score_transaction.py');
const WORKER_SCRIPT = path.resolve(__dirname, '..', 'score_worker.py');

// In-memory cache for fast repeated queries
const scoreCache = new Map();

// Persistent Python worker process for <5ms low-latency inference
let workerProcess = null;
let reqIdCounter = 1;
const pendingRequests = new Map();
let workerReady = false;

function initWorker() {
  if (workerProcess) return;
  const pythonExec = getPythonExecutable();

  try {
    workerProcess = spawn(pythonExec, [WORKER_SCRIPT], {
      windowsHide: true,
      cwd: path.resolve(__dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let buffer = '';
    workerProcess.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep trailing remainder

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.status === 'ready') {
            workerReady = true;
            continue;
          }
          if (parsed.id !== undefined && pendingRequests.has(parsed.id)) {
            const { resolve, timer } = pendingRequests.get(parsed.id);
            clearTimeout(timer);
            pendingRequests.delete(parsed.id);
            resolve(parsed);
          }
        } catch (_) {}
      }
    });

    workerProcess.stderr.on('data', () => {});

    workerProcess.on('close', () => {
      workerProcess = null;
      workerReady = false;
      for (const [id, { resolve, timer }] of pendingRequests.entries()) {
        clearTimeout(timer);
        resolve(null);
      }
      pendingRequests.clear();
    });

    workerProcess.on('error', () => {
      workerProcess = null;
      workerReady = false;
    });

    if (workerProcess.stdout?.unref) workerProcess.stdout.unref();
    if (workerProcess.stdin?.unref) workerProcess.stdin.unref();
    if (workerProcess.stderr?.unref) workerProcess.stderr.unref();
    if (workerProcess.unref) {
      workerProcess.unref();
    }
  } catch (_) {
    workerProcess = null;
    workerReady = false;
  }
}

export function closeWorker() {
  if (workerProcess) {
    try { workerProcess.kill(); } catch (_) {}
    workerProcess = null;
    workerReady = false;
  }
}

// Start persistent scoring worker immediately on server launch
initWorker();

function sendToWorker(payload, timeoutMs = 2500) {
  return new Promise((resolve) => {
    if (!workerProcess || !workerProcess.stdin.writable) {
      initWorker();
    }
    if (!workerProcess || !workerProcess.stdin.writable) {
      return resolve(null);
    }

    const id = ++reqIdCounter;
    payload.id = id;

    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      resolve(null);
    }, timeoutMs);

    pendingRequests.set(id, { resolve, timer });

    try {
      workerProcess.stdin.write(JSON.stringify(payload) + '\n');
    } catch (_) {
      clearTimeout(timer);
      pendingRequests.delete(id);
      resolve(null);
    }
  });
}

/**
 * Fallback probability calculation if Python environment is unavailable.
 */
export function heuristicFallback(amountInr, confidence, bank, rootCause, isBusinessHours) {
  if (rootCause === 'transient_gateway_error') {
    let base = confidence >= 0.8 ? 0.93 : 0.70;
    if (isBusinessHours === 1) base += 0.03;
    if (amountInr > 20000) base -= 0.28;
    else if (amountInr > 2000) base -= 0.16;
    if (['HDFC', 'ICICI'].includes(bank)) base += 0.02;
    return Math.min(Math.max(base, 0.20), 0.98);
  }
  if (rootCause === 'auth_dropped_3ds') {
    let base = isBusinessHours === 1 ? 0.65 : 0.38;
    if (amountInr > 20000) base -= 0.12;
    else if (amountInr > 5000) base -= 0.06;
    return Math.min(Math.max(base, 0.20), 0.88);
  }
  if (rootCause === 'user_abandoned_checkout') {
    let base = isBusinessHours === 1 ? 0.54 : 0.30;
    if (amountInr > 20000) base -= 0.10;
    return Math.min(Math.max(base, 0.15), 0.78);
  }
  if (rootCause === 'insufficient_funds') {
    let base = isBusinessHours === 1 ? 0.42 : 0.22;
    if (amountInr > 20000) base -= 0.10;
    return Math.min(Math.max(base, 0.10), 0.68);
  }
  return 0.25;
}

/**
 * Score a transaction using the trained Gradient Boosting ML model.
 * 
 * @param {Object} options
 * @param {number} options.amountInr - Transaction amount in INR
 * @param {number} options.confidence - Classifier confidence (0.0 - 1.0)
 * @param {string} options.bank - Bank name (e.g. 'HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK')
 * @param {string} options.rootCause - Root cause (e.g. 'transient_gateway_error')
 * @param {number} [options.isBusinessHours] - 1 if 9am-9pm, else 0
 * @param {string} [options.model] - Optional custom model filename
 * @returns {Promise<{ recovery_probability: number, model: string, source: string }>}
 */
export async function scoreTransactionML({
  amountInr = 1200,
  confidence = 0.85,
  bank = 'HDFC',
  rootCause = 'transient_gateway_error',
  isBusinessHours = 1,
  model = null
} = {}) {
  // Validate and normalize parameters
  const normAmount = Number(amountInr) || 1200;
  const normConf = Number(confidence) || 0.85;
  const normBank = (bank || 'HDFC').toUpperCase();
  const normCause = rootCause || 'transient_gateway_error';
  const normHours = isBusinessHours !== undefined ? Number(isBusinessHours) : 1;

  const cacheKey = `${Math.round(normAmount / 10) * 10}_${normConf}_${normBank}_${normCause}_${normHours}_${model || 'default'}`;
  if (scoreCache.has(cacheKey)) {
    return scoreCache.get(cacheKey);
  }

  // 1. Fast path: Try persistent in-memory worker (< 10ms)
  const workerResp = await sendToWorker({
    action: 'score',
    model: model || 'recovery_model_gradient_boosting.joblib',
    data: {
      amountInr: normAmount,
      confidence: normConf,
      bank: normBank,
      rootCause: normCause,
      isBusinessHours: normHours
    }
  });

  if (workerResp && typeof workerResp.recovery_probability === 'number') {
    const res = {
      recovery_probability: workerResp.recovery_probability,
      model: workerResp.model || (model || 'recovery_model_gradient_boosting.joblib'),
      source: 'ml_worker_fast'
    };
    scoreCache.set(cacheKey, res);
    return res;
  }

  // 2. Fallback path: Standalone python execution if worker is not yet spun up
  const pythonExec = getPythonExecutable();

  return new Promise((resolve) => {
    const args = [
      SCRIPT_PATH,
      '--amount', String(normAmount),
      '--confidence', String(normConf),
      '--bank', normBank,
      '--root_cause', normCause,
      '--is_business_hours', String(normHours)
    ];

    if (model) {
      args.push('--model', model);
    }

    const pyProcess = spawn(pythonExec, args, {
      windowsHide: true,
      cwd: path.resolve(__dirname, '..')
    });

    let stdout = '';
    let stderr = '';

    pyProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pyProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      try { pyProcess.kill(); } catch (_) {}
      const fallbackProb = heuristicFallback(normAmount, normConf, normBank, normCause, normHours);
      const res = {
        recovery_probability: Math.round(fallbackProb * 10000) / 10000,
        model: 'heuristic_fallback',
        source: 'timeout_fallback'
      };
      scoreCache.set(cacheKey, res);
      resolve(res);
    }, 4000);

    pyProcess.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0 && stdout) {
        try {
          const parsed = JSON.parse(stdout.trim());
          const res = {
            recovery_probability: parsed.recovery_probability,
            model: parsed.model || 'recovery_model_gradient_boosting.joblib',
            source: 'ml_model'
          };
          scoreCache.set(cacheKey, res);
          return resolve(res);
        } catch (_) {}
      }

      const fallbackProb = heuristicFallback(normAmount, normConf, normBank, normCause, normHours);
      const res = {
        recovery_probability: Math.round(fallbackProb * 10000) / 10000,
        model: 'heuristic_fallback',
        source: 'error_fallback',
        error: stderr.trim() || undefined
      };
      scoreCache.set(cacheKey, res);
      resolve(res);
    });

    pyProcess.on('error', () => {
      clearTimeout(timeout);
      const fallbackProb = heuristicFallback(normAmount, normConf, normBank, normCause, normHours);
      const res = {
        recovery_probability: Math.round(fallbackProb * 10000) / 10000,
        model: 'heuristic_fallback',
        source: 'process_error_fallback'
      };
      scoreCache.set(cacheKey, res);
      resolve(res);
    });
  });
}

/**
 * Score a batch of transactions in a single vectorized Python execution.
 * 
 * @param {Array<Object>} transactions
 * @param {string} [model]
 * @returns {Promise<{ recovery_probabilities: Array<number>, model: string }>}
 */
export async function scoreBatchML(transactions = [], model = null) {
  if (!transactions.length) {
    return { recovery_probabilities: [], model: model || 'recovery_model_gradient_boosting.joblib' };
  }

  // 1. Fast path: Try persistent in-memory worker (< 20ms for 200 transactions)
  const workerResp = await sendToWorker({
    action: 'score_batch',
    model: model || 'recovery_model_gradient_boosting.joblib',
    transactions
  });

  if (workerResp && Array.isArray(workerResp.recovery_probabilities)) {
    return {
      recovery_probabilities: workerResp.recovery_probabilities,
      model: workerResp.model || (model || 'recovery_model_gradient_boosting.joblib'),
      source: 'ml_worker_fast'
    };
  }

  // 2. Fallback path: Standalone python execution
  const pythonExec = getPythonExecutable();

  return new Promise((resolve) => {
    const args = [SCRIPT_PATH, '--stdin'];
    if (model) {
      args.push('--model', model);
    }

    const pyProcess = spawn(pythonExec, args, {
      windowsHide: true,
      cwd: path.resolve(__dirname, '..')
    });

    let stdout = '';
    let stderr = '';

    pyProcess.stdout.on('data', (d) => { stdout += d.toString(); });
    pyProcess.stderr.on('data', (d) => { stderr += d.toString(); });

    const timeout = setTimeout(() => {
      try { pyProcess.kill(); } catch (_) {}
      const fallbackProbs = transactions.map(t =>
        heuristicFallback(
          t.amountInr ?? t.amount_inr ?? 1200,
          t.confidence ?? 0.85,
          t.bank ?? 'HDFC',
          t.rootCause ?? t.root_cause ?? 'transient_gateway_error',
          t.isBusinessHours ?? t.is_business_hours ?? 1
        )
      );
      resolve({
        recovery_probabilities: fallbackProbs,
        model: 'heuristic_fallback',
        source: 'timeout_fallback'
      });
    }, 6000);

    pyProcess.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0 && stdout) {
        try {
          const parsed = JSON.parse(stdout.trim());
          if (Array.isArray(parsed.recovery_probabilities)) {
            return resolve({
              recovery_probabilities: parsed.recovery_probabilities,
              model: parsed.model || 'recovery_model_gradient_boosting.joblib',
              source: 'ml_model'
            });
          }
        } catch (_) {}
      }

      const fallbackProbs = transactions.map(t =>
        heuristicFallback(
          t.amountInr ?? t.amount_inr ?? 1200,
          t.confidence ?? 0.85,
          t.bank ?? 'HDFC',
          t.rootCause ?? t.root_cause ?? 'transient_gateway_error',
          t.isBusinessHours ?? t.is_business_hours ?? 1
        )
      );
      resolve({
        recovery_probabilities: fallbackProbs,
        model: 'heuristic_fallback',
        source: 'error_fallback',
        error: stderr.trim() || undefined
      });
    });

    pyProcess.on('error', () => {
      clearTimeout(timeout);
      const fallbackProbs = transactions.map(t =>
        heuristicFallback(
          t.amountInr ?? t.amount_inr ?? 1200,
          t.confidence ?? 0.85,
          t.bank ?? 'HDFC',
          t.rootCause ?? t.root_cause ?? 'transient_gateway_error',
          t.isBusinessHours ?? t.is_business_hours ?? 1
        )
      );
      resolve({
        recovery_probabilities: fallbackProbs,
        model: 'heuristic_fallback',
        source: 'process_error_fallback'
      });
    });

    // Write batch JSON payload to stdin
    pyProcess.stdin.write(JSON.stringify(transactions));
    pyProcess.stdin.end();
  });
}
