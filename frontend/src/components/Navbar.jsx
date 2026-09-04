import React from 'react';
import { Zap, Mic, Volume2, Sun, Moon, Play } from 'lucide-react';
import { playRazorpayChime } from '../utils/soundbox.js';
import { playVoiceExecutiveBriefing } from '../utils/speech.js';

export default function Navbar({
  metrics,
  bankHealth,
  theme,
  toggleTheme,
  runningPipeline,
  onRunPipeline
}) {
  return (
    <header className="header">
      <div className="header-left">
        <div className="razorpay-logo">
          <div className="razorpay-logo-icon">
            <Zap size={22} color="#ffffff" fill="#ffffff" />
          </div>
          <span>RAZORPAY</span>
        </div>
        <span className="badge-buildathon">AI REVENUE RECOVERY AGENT</span>
      </div>

      <div className="header-right">
        <button 
          className="btn btn-theme" 
          onClick={() => playVoiceExecutiveBriefing(metrics, bankHealth)}
          title="Play AI Voice Executive Briefing"
          aria-label="Play AI Voice Executive Briefing"
        >
          <Mic size={18} />
        </button>

        <button 
          className="btn btn-theme" 
          onClick={playRazorpayChime}
          title="Test Razorpay Soundbox Chime"
          aria-label="Test Razorpay Soundbox Chime"
        >
          <Volume2 size={18} />
        </button>

        <button 
          className="btn btn-theme" 
          onClick={toggleTheme}
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
          aria-label="Toggle Theme"
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <button 
          className="btn btn-primary" 
          onClick={onRunPipeline}
          disabled={runningPipeline}
        >
          <Play size={16} />
          {runningPipeline ? 'Running Pipeline...' : 'Run Pipeline'}
        </button>
      </div>
    </header>
  );
}
