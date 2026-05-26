// ── EmailJS configuration ─────────────────────────────────────────────────────
//
// To enable email reminders:
//
//  1. Create a free account at https://www.emailjs.com/
//  2. Add an Email Service (Gmail, Outlook, etc.) under "Email Services".
//  3. Create an Email Template under "Email Templates".
//     You can use any of these variables in the template body:
//
//       {{to_email}}          – recipient's address
//       {{to_name}}           – the diver's username
//       {{item_name}}         – gear item name / model
//       {{item_category}}     – equipment category
//       {{days_until}}        – e.g. "14 days" or "Overdue by 3 days"
//       {{next_service_date}} – formatted service due date
//
//  4. Paste your keys into the three fields below.
//
const EMAILJS_CONFIG = {
  publicKey:        'ZNzs5ZWX2I4JCtOP0',   // Account → General → Public Key
  serviceId:        'service_xe6n7dr',      // Email Services → <your service> → Service ID
  templateId:       'template_cmh1f9g',     // Email Templates → service reminder template
  resetTemplateId:  'template_bb3u2io', // Email Templates → password reset template
  //
  // Password-reset template variables:
  //   {{to_email}}   – recipient address
  //   {{to_name}}    – username
  //   {{reset_code}} – 6-digit code
  //   {{expiry_min}} – "15" (minutes until expiry)
};

(function initEmailJS() {
  if (typeof emailjs === 'undefined') {
    console.warn('[Dive Gear] EmailJS library not loaded.');
    return;
  }
  emailjs.init({ publicKey: EMAILJS_CONFIG.publicKey });
  console.info('[Dive Gear] EmailJS initialised. Reset template ready:', resetEmailReady());
})();

function emailjsReady() {
  return typeof emailjs !== 'undefined' &&
    EMAILJS_CONFIG.publicKey  !== 'YOUR_PUBLIC_KEY' &&
    EMAILJS_CONFIG.serviceId  !== 'YOUR_SERVICE_ID' &&
    EMAILJS_CONFIG.templateId !== 'YOUR_TEMPLATE_ID';
}

function resetEmailReady() {
  return emailjsReady() && EMAILJS_CONFIG.resetTemplateId !== 'YOUR_RESET_TEMPLATE_ID';
}

// Read the stored email for a given username directly from localStorage
// (no dependency on auth.js so this file can load before it).
function getUserEmail(username) {
  if (!username) return null;
  const users = JSON.parse(localStorage.getItem('diveUsers') || '{}');
  return users[username]?.email || null;
}

function sendResetEmail(toEmail, username, code) {
  if (!resetEmailReady()) {
    return Promise.reject(new Error('Reset email template not configured.'));
  }
  return emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.resetTemplateId, {
    to_email:   toEmail,
    to_name:    username,
    reset_code: code,
    expiry_min: '15',
  });
}

function sendReminderEmail(toEmail, username, item, daysUntil) {
  if (!emailjsReady()) {
    console.info('[Dive Gear] EmailJS not configured — reminder skipped for:', item.name);
    return;
  }

  const abs = Math.abs(daysUntil);
  const daysLabel = daysUntil <= 0
    ? `Overdue by ${abs} day${abs !== 1 ? 's' : ''}`
    : `${daysUntil} day${daysUntil !== 1 ? 's' : ''}`;

  const nextDateFormatted = item.nextService
    ? (typeof formatDate === 'function' ? formatDate(item.nextService) : item.nextService)
    : 'N/A';

  emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, {
    to_email:          toEmail,
    to_name:           username,
    item_name:         item.name,
    item_category:     item.category,
    days_until:        daysLabel,
    next_service_date: nextDateFormatted,
  }).then(
    ()  => console.info('[Dive Gear] Reminder sent for:', item.name),
    err => console.error('[Dive Gear] EmailJS error for', item.name, ':', err),
  );
}
