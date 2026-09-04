import React from 'react';
import { MessageSquare, Mail, Globe, X, Send } from 'lucide-react';
import { playRazorpayChime } from '../utils/soundbox.js';

export function getLocalizedNudgeText(item, lang) {
  const amount = item?.amount_inr?.toLocaleString();
  const orderId = item?.order_id;
  const cause = item?.root_cause;
  const link = `https://rzp.io/l/pay_${orderId}`;

  switch (lang) {
    case 'hi':
      return {
        greeting: 'नमस्ते! 👋',
        body: `हमने देखा कि आपका ऑर्डर #${orderId} का ₹${amount} का भुगतान ${cause} के कारण अधूरा रह गया था।`,
        sub: 'चिंता न करें! 1-क्लिक UPI / GPay द्वारा अपना भुगतान सुरक्षित रूप से पूरा करने के लिए नीचे टैप करें:',
        link
      };
    case 'ta':
      return {
        greeting: 'வணக்கம்! 👋',
        body: `உங்கள் ஆர்டர் #${orderId} க்கான ₹${amount} தொகையானது ${cause} காரணமாக முழுமையடையவில்லை.`,
        sub: 'கவலைப்பட வேண்டாம்! UPI / GPay மூலம் 1-கிளிக் மூலம் உங்கள் கட்டணத்தை முடிக்க கீழே தட்டவும்:',
        link
      };
    case 'te':
      return {
        greeting: 'నమస్కారం! 👋',
        body: `మీ ఆర్డర్ #${orderId} యొక్క ₹${amount} చెల్లింపు ${cause} వల్ల నిలిచిపోయినట్లు గుర్తించాము.`,
        sub: 'చింతించకండి! UPI / GPay ద్వారా 1-క్లిక్‌తో చెల్లింపు పూర్తి చేయడానికి క్రింద నొక్కండి:',
        link
      };
    case 'kn':
      return {
        greeting: 'ನಮಸ್ಕಾರ! 👋',
        body: `ನಿಮ್ಮ ಆರ್ಡರ್ #${orderId} ನ ₹${amount} ಪಾವತಿಯು ${cause} ಕಾರಣದಿಂದ ಅಪೂರ್ಣವಾಗಿದೆ.`,
        sub: 'ಚಿಂತಿಸಬೇಡಿ! UPI / GPay ಮೂಲಕ 1-ಕ್ಲಿಕ್‌ನಲ್ಲಿ ಪಾವತಿಯನ್ನು ಪೂರ್ಣಗೊಳಿಸಲು ಕೆಳಗೆ ಟ್ಯಾಪ್ ಮಾಡಿ:',
        link
      };
    default:
      return {
        greeting: 'Hi there! 👋',
        body: `We noticed your recent payment of ₹${amount} for Order #${orderId} was incomplete due to a temporary ${cause}.`,
        sub: 'No worries! Tap below to safely complete your payment in 1-click via UPI / GPay:',
        link
      };
  }
}

export default function NudgeModal({
  modalState,
  onClose,
  onNudgeSent
}) {
  if (!modalState.open || !modalState.item) return null;

  const { item, lang, type } = modalState;
  const text = getLocalizedNudgeText(item, lang);

  const handleSend = () => {
    playRazorpayChime();
    onNudgeSent({
      type: 'success',
      text: `${type === 'email' ? 'HTML Email' : 'WhatsApp'} nudge (${lang.toUpperCase()}) delivered to ${item.customer_id}`
    });
    onClose();
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#0b141a', color: '#ffffff', borderRadius: '1rem', width: '420px', padding: '1.25rem', boxShadow: '0 10px 25px rgba(0,0,0,0.5)', border: '1px solid #2a3942' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #2a3942', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <MessageSquare size={18} color="#25d366" />
            <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>AI Customer Nudge Preview</span>
          </div>
          <button 
            style={{ background: 'none', border: 'none', color: '#8696a0', cursor: 'pointer' }} 
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        {/* Channel Toggle (WhatsApp / Email) */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <button 
            style={{ 
              flex: 1, 
              padding: '0.4rem', 
              borderRadius: '0.375rem', 
              border: '1px solid #2a3942', 
              background: type === 'whatsapp' ? '#25d366' : '#111b21', 
              color: '#ffffff', 
              fontWeight: 600, 
              cursor: 'pointer', 
              fontSize: '0.8rem' 
            }}
            onClick={() => modalState.setType ? modalState.setType('whatsapp') : null}
          >
            <MessageSquare size={14} style={{ display: 'inline', marginRight: '4px' }} /> WhatsApp Nudge
          </button>
          <button 
            style={{ 
              flex: 1, 
              padding: '0.4rem', 
              borderRadius: '0.375rem', 
              border: '1px solid #2a3942', 
              background: type === 'email' ? '#0066ff' : '#111b21', 
              color: '#ffffff', 
              fontWeight: 600, 
              cursor: 'pointer', 
              fontSize: '0.8rem' 
            }}
            onClick={() => modalState.setType ? modalState.setType('email') : null}
          >
            <Mail size={14} style={{ display: 'inline', marginRight: '4px' }} /> HTML Email Nudge
          </button>
        </div>

        {/* Language Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', background: '#111b21', padding: '0.5rem', borderRadius: '0.5rem' }}>
          <Globe size={16} color="#8696a0" />
          <span style={{ fontSize: '0.8rem', color: '#8696a0', fontWeight: 600 }}>Language:</span>
          <select 
            value={lang}
            onChange={(e) => modalState.setLang ? modalState.setLang(e.target.value) : null}
            style={{ background: '#202c33', color: '#ffffff', border: '1px solid #2a3942', borderRadius: '0.375rem', padding: '0.2rem 0.5rem', fontSize: '0.8rem', outline: 'none', flex: 1 }}
          >
            <option value="en">English</option>
            <option value="hi">हिंदी (Hindi)</option>
            <option value="ta">தமிழ் (Tamil)</option>
            <option value="te">తెలుగు (Telugu)</option>
            <option value="kn">ಕನ್ನಡ (Kannada)</option>
          </select>
        </div>

        {/* Message Body */}
        {type === 'email' ? (
          <div style={{ background: '#ffffff', color: '#0f172a', borderRadius: '0.75rem', padding: '1rem', fontSize: '0.85rem', lineHeight: '1.5' }}>
            <div style={{ borderBottom: '2px solid #0066ff', paddingBottom: '0.5rem', marginBottom: '0.75rem', fontWeight: 700, color: '#0066ff' }}>
              Razorpay Store — Payment Action Required
            </div>
            <p style={{ marginBottom: '0.5rem', fontWeight: 600 }}>{text.greeting}</p>
            <p style={{ marginBottom: '0.5rem' }}>{text.body}</p>
            <p style={{ marginBottom: '0.75rem' }}>{text.sub}</p>
            <div style={{ background: '#0066ff', color: '#ffffff', padding: '0.65rem', borderRadius: '0.5rem', textAlign: 'center', fontWeight: 700, fontSize: '0.85rem' }}>
              Complete Payment via Razorpay
            </div>
          </div>
        ) : (
          <div style={{ background: '#111b21', borderRadius: '0.75rem', padding: '1rem', borderLeft: '4px solid #25d366', fontSize: '0.875rem', lineHeight: '1.5', color: '#e9edef' }}>
            <p style={{ marginBottom: '0.5rem', fontWeight: 600 }}>{text.greeting}</p>
            <p style={{ marginBottom: '0.5rem' }}>{text.body}</p>
            <p style={{ marginBottom: '0.75rem' }}>{text.sub}</p>
            <div style={{ background: '#202c33', padding: '0.65rem', borderRadius: '0.5rem', textAlign: 'center', border: '1px solid #00a884', color: '#00a884', fontWeight: 700, fontSize: '0.85rem' }}>
              {text.link}
            </div>
          </div>
        )}

        <button 
          className="btn btn-success" 
          style={{ width: '100%', marginTop: '1rem', background: type === 'email' ? '#0066ff' : '#25d366' }}
          onClick={handleSend}
        >
          <Send size={16} /> Send {type === 'email' ? 'Email' : 'WhatsApp'} Nudge
        </button>
      </div>
    </div>
  );
}
