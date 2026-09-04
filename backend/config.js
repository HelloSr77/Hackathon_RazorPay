import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, './.env') });

export const DB_PATH = process.env.DATABASE_URL || path.resolve(__dirname, './recovery.db');

// Explicit LLM Configuration (Provider-Agnostic)
export const LLM_PROVIDER = (process.env.LLM_PROVIDER || '').trim().toLowerCase();
export const LLM_API_KEY = process.env.LLM_API_KEY || process.env.GROQ_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.API_KEY || '';
export const LLM_MODEL = process.env.LLM_MODEL || '';

// Groq Configuration
export const GROQ_API_KEY = process.env.GROQ_API_KEY || (LLM_API_KEY.startsWith('gsk_') ? LLM_API_KEY : '');
export const GROQ_MODEL = process.env.GROQ_MODEL || (LLM_MODEL && !LLM_MODEL.includes('claude') && !LLM_MODEL.includes('gemini') ? LLM_MODEL : 'groq/compound-mini');

// Backwards-compatible aliases
export const ANTHROPIC_API_KEY = LLM_API_KEY;
export const ANTHROPIC_MODEL = LLM_MODEL || process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022';

export const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
export const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';

// Messaging APIs
export const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
export const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
export const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';
export const FAST2SMS_API_KEY = process.env.FAST2SMS_API_KEY || '';

export const AUTO_RECOVER_MAX_AMOUNT_INR = 2000;
export const AUTO_RECOVER_MIN_CONFIDENCE = 0.75;
export const QUEUE_MIN_CONFIDENCE = 0.40;
export const MAX_RETRIES_PER_TRANSACTION = 2;

// Compliance Guardrails (TRAI DND window: 9 PM to 9 AM)
export const DND_START_HOUR = 21; // 21:00 (9:00 PM)
export const DND_END_HOUR = 9;   // 09:00 (9:00 AM)
export const DND_ENABLED = true;

export let runtimeSettings = {
  AUTO_RECOVER_MAX_AMOUNT_INR: 2000,
  AUTO_RECOVER_MIN_CONFIDENCE: 0.75,
  QUEUE_MIN_CONFIDENCE: 0.40,
  MAX_RETRIES_PER_TRANSACTION: 2,
  DND_ENABLED: true,
  DND_START_HOUR: 21,
  DND_END_HOUR: 9,
};

export function getSettings() {
  return {
    ...runtimeSettings,
    LLM_PROVIDER: LLM_PROVIDER || (LLM_API_KEY.startsWith('gsk_') ? 'groq (inferred)' : LLM_API_KEY.startsWith('AIza') ? 'gemini (inferred)' : LLM_API_KEY.startsWith('sk-ant-') ? 'anthropic (inferred)' : LLM_API_KEY ? 'openai (inferred)' : 'none (rule-based)'),
    HAS_LLM_KEY: Boolean(LLM_API_KEY),
  };
}

export function updateSettings(newSettings) {
  if (newSettings.AUTO_RECOVER_MAX_AMOUNT_INR !== undefined) {
    runtimeSettings.AUTO_RECOVER_MAX_AMOUNT_INR = Number(newSettings.AUTO_RECOVER_MAX_AMOUNT_INR);
  }
  if (newSettings.AUTO_RECOVER_MIN_CONFIDENCE !== undefined) {
    runtimeSettings.AUTO_RECOVER_MIN_CONFIDENCE = Number(newSettings.AUTO_RECOVER_MIN_CONFIDENCE);
  }
  if (newSettings.QUEUE_MIN_CONFIDENCE !== undefined) {
    runtimeSettings.QUEUE_MIN_CONFIDENCE = Number(newSettings.QUEUE_MIN_CONFIDENCE);
  }
  if (newSettings.MAX_RETRIES_PER_TRANSACTION !== undefined) {
    runtimeSettings.MAX_RETRIES_PER_TRANSACTION = Number(newSettings.MAX_RETRIES_PER_TRANSACTION);
  }
  if (newSettings.DND_ENABLED !== undefined) {
    runtimeSettings.DND_ENABLED = Boolean(newSettings.DND_ENABLED);
  }
  if (newSettings.DND_START_HOUR !== undefined) {
    runtimeSettings.DND_START_HOUR = Number(newSettings.DND_START_HOUR);
  }
  if (newSettings.DND_END_HOUR !== undefined) {
    runtimeSettings.DND_END_HOUR = Number(newSettings.DND_END_HOUR);
  }
  return getSettings();
}

export const RETRY_COOL_DOWN_MINUTES = 15;
export const MAX_RECOVERY_ATTEMPTS_PER_CUSTOMER_PER_DAY = 3;

export const BANK_OUTAGE_FAILURE_THRESHOLD = 5;
export const BANK_OUTAGE_WINDOW_MINUTES = 10;

export const ROOT_CAUSES = [
  'transient_gateway_error',
  'insufficient_funds',
  'dead_card',
  'auth_dropped_3ds',
  'user_abandoned_checkout',
  'bank_outage',
  'unknown',
];
