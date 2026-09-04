import React from 'react';
import { CheckCircle, AlertCircle } from 'lucide-react';

export default function Toast({ message }) {
  if (!message) return null;

  return (
    <div className={`toast-notification ${message.type === 'error' ? 'toast-error' : 'toast-success'}`}>
      {message.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle size={18} />}
      <span>{message.text}</span>
    </div>
  );
}
