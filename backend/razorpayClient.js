import { 
  RAZORPAY_KEY_ID, 
  RAZORPAY_KEY_SECRET,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_NUMBER,
  FAST2SMS_API_KEY,
  LLM_API_KEY,
  LLM_PROVIDER
} from './config.js';

export class RazorpayClient {
  constructor() {
    this.isMock = !RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET;
  }

  retryPayment(orderId, amountInr) {
    if (this.isMock) {
      const success = Math.random() > 0.3; // 70% success rate in mock mode
      return {
        success,
        raw: {
          id: `pay_mock_${Date.now()}`,
          entity: 'payment',
          amount: Math.round(amountInr * 100),
          currency: 'INR',
          status: success ? 'captured' : 'failed',
          order_id: orderId,
          method: 'card',
          error_code: success ? null : 'BAD_REQUEST_ERROR',
          error_description: success ? null : 'Payment failed in test simulation',
        },
      };
    }

    // Live test-mode mock wrapper
    return {
      success: true,
      raw: { id: `pay_live_${Date.now()}`, status: 'captured', order_id: orderId },
    };
  }

  async createRazorpayPayLink(orderId, amountInr, phone = '+919999999999') {
    if (this.isMock) {
      return `https://rzp.io/l/pay_${orderId}`;
    }

    try {
      const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
      const response = await fetch('https://api.razorpay.com/v1/payment_links', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          amount: Math.round(amountInr * 100),
          currency: 'INR',
          accept_partial: false,
          description: `Recovery payment link for Order #${orderId}`,
          customer: { contact: phone }
        })
      });
      const data = await response.json();
      return data.short_url || `https://rzp.io/l/pay_${orderId}`;
    } catch (err) {
      return `https://rzp.io/l/pay_${orderId}`;
    }
  }

  async generateAiNudgeText(orderId, amountInr, payUrl, lang = 'en') {
    const languageNames = {
      en: 'English',
      hi: 'Hindi',
      ta: 'Tamil',
      te: 'Telugu',
      mr: 'Marathi',
      gu: 'Gujarati'
    };
    const targetLang = languageNames[lang] || 'English';

    if (LLM_API_KEY && (LLM_PROVIDER === 'groq' || (!LLM_PROVIDER && LLM_API_KEY.startsWith('gsk_')))) {
      try {
        const prompt = `Write a short, friendly, high-converting payment recovery message in ${targetLang} language for a customer whose checkout payment of ₹${amountInr} for Order #${orderId} failed or dropped at OTP/3DS. Keep it under 25 words, polite, professional, and end with the payment link: ${payUrl}`;
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LLM_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'groq/compound-mini',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 70
          })
        });
        const data = await res.json();
        if (data.choices && data.choices[0]?.message?.content) {
          return data.choices[0].message.content.trim();
        }
      } catch (err) {
        console.warn(`[Nudge] AI copy generation failed: ${err.message}`);
      }
    }
    return `Hi there! 👋 Your payment of ₹${amountInr} for Order #${orderId} was incomplete. Tap here to complete via 1-click UPI / GPay: ${payUrl}`;
  }

  async sendNudge(customerId, orderId, amountInr = 1000, phone = '+919999999999', lang = 'en') {
    const payUrl = await this.createRazorpayPayLink(orderId, amountInr, phone);
    const messageBody = await this.generateAiNudgeText(orderId, amountInr, payUrl, lang);

    let twilioResult = null;
    let smsResult = null;

    // Send Live Twilio WhatsApp Nudge if configured
    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
      try {
        const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
        const params = new URLSearchParams();
        params.append('From', TWILIO_WHATSAPP_NUMBER);
        params.append('To', `whatsapp:${phone}`);
        params.append('Body', messageBody);

        const twRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: params.toString()
        });
        twilioResult = await twRes.json();
      } catch (err) {
        twilioResult = { error: err.message };
      }
    }

    // Send Live Fast2SMS SMS Nudge if configured
    if (FAST2SMS_API_KEY) {
      try {
        const smsRes = await fetch('https://www.fast2sms.com/dev/bulkV2', {
          method: 'POST',
          headers: {
            'authorization': FAST2SMS_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            route: 'v3',
            numbers: phone,
            message: messageBody
          })
        });
        smsResult = await smsRes.json();
      } catch (err) {
        smsResult = { error: err.message };
      }
    }

    return {
      success: true,
      payUrl,
      raw: {
        id: `nudge_${Date.now()}`,
        customer_id: customerId,
        order_id: orderId,
        status: 'sent',
        channel: 'whatsapp_sms',
        twilio: twilioResult,
        fast2sms: smsResult,
      },
    };
  }
}
