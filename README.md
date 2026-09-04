# Revenue Recovery Agent (JavaScript / React + Node.js)

**Razorpay AI Buildathon — Track 03: AI Revenue Recovery**

Direction: *Payment degradation → root cause → recovery action.*

An agent built in **JavaScript (Node.js + React)** that detects failed/degraded payments, diagnoses the root cause (with cross-transaction correlation to catch systemic bank outages, not just isolated card problems), decides on a bounded recovery action through a confidence-tiered escalation ladder, executes it against Razorpay test-mode APIs, and logs every decision to a full audit trail.

---

## Architecture

```
detect (failed transaction)
   │
   ▼
diagnose (LLM or rule-based classifier)  ──┐
   │                                        │
   ▼                                        │
correlate (bank-outage check) ──────────────┘
   │
   ▼
decide (confidence-tiered escalation ladder: auto / queue / stop)
   │
   ▼
act (bounded by hard caps + cool-downs, regardless of confidence)
   │
   ▼
log (audit trail: every decision + outcome, including "did nothing")
```

---

## Tech Stack

- **Frontend (`frontend/`)**: React, Vite, Lucide Icons, CSS3.
- **Backend (`backend/`)**: Node.js, Express, `node:sqlite` (native built-in SQLite).
- **Classifier (`backend/classifier.js`)**: `@anthropic-ai/sdk` (with zero-dependency deterministic rule-based fallback).

---

## Setup & Running

### 1. Install & Run Express API Backend

```bash
cd backend
npm install
npm start
```
*Express backend runs on `http://localhost:5000`*

### 2. Install & Run React Web Frontend

```bash
cd frontend
npm install
npm run dev
```
*React frontend runs on `http://localhost:3000`*

---

## Commands & Testing

```bash
# Run unit tests (6/6 guardrail tests)
cd backend
npm test

# Run recovery batch pipeline via CLI
cd backend
npm run pipeline
```

---

## Repository Structure

```
backend/
  recovery.db        # SQLite database
  config.js          # Hard caps, escalation thresholds & constants
  db.js              # Database schemas via built-in node:sqlite
  syntheticData.js   # Labeled synthetic batch generator
  classifier.js      # Zero/few-shot LLM & rule-based classifier
  correlation.js     # Bank-outage detector
  guardrails.js      # Escalation ladder & hard bounds rules
  razorpayClient.js  # Razorpay test-mode & mock API client
  approvalQueue.js   # Merchant approval/rejection handler
  audit.js           # Headline metrics & audit log queries
  recoveryEngine.js  # Pipeline orchestrator
  runPipeline.js     # CLI pipeline runner
  index.js           # Express REST API server
  package.json
  tests/
    guardrails.test.js  # Automated guardrail unit tests
frontend/
  src/
    App.jsx          # React Dashboard component
    main.jsx
    index.css
  index.html
  package.json
  vite.config.js
```
