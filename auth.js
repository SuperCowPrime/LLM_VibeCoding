async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function getUsers() {
  return JSON.parse(localStorage.getItem('diveUsers') || '{}');
}

function saveUsers(users) {
  localStorage.setItem('diveUsers', JSON.stringify(users));
}

function getCurrentUser() {
  return sessionStorage.getItem('diveSession') || null;
}

function setCurrentUser(username) {
  sessionStorage.setItem('diveSession', username);
}

function clearSession() {
  sessionStorage.removeItem('diveSession');
}

async function registerUser(username, password, email) {
  const users = getUsers();
  if (users[username]) return { ok: false, error: 'Username already taken.' };
  const passwordHash = await hashPassword(password);
  users[username] = { passwordHash, email: email || '' };
  saveUsers(users);
  return { ok: true };
}

async function loginUser(username, password) {
  const users = getUsers();
  if (!users[username]) return { ok: false, error: 'Username not found.' };
  const passwordHash = await hashPassword(password);
  if (users[username].passwordHash !== passwordHash) return { ok: false, error: 'Incorrect password.' };
  return { ok: true };
}

// ── Password toggle ──────────────────────────────────────────────────────────

function togglePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btn.textContent = showing ? '👁' : '🙈';
  btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
}

// ── Password Reset ────────────────────────────────────────────────────────────

function getResets() {
  return JSON.parse(localStorage.getItem('diveResets') || '{}');
}

function saveResets(resets) {
  localStorage.setItem('diveResets', JSON.stringify(resets));
}

function generateResetCode(username) {
  const users = getUsers();
  if (!users[username]) return { ok: false, error: 'Username not found.' };
  const code    = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = Date.now() + 15 * 60 * 1000; // 15 min
  const resets  = getResets();
  resets[username] = { code, expires };
  saveResets(resets);
  return { ok: true, code, email: users[username].email || '' };
}

function validateResetCode(username, code) {
  const resets = getResets();
  const entry  = resets[username];
  if (!entry) return { ok: false, error: 'No reset request found. Please start over.' };
  if (Date.now() > entry.expires) {
    delete resets[username];
    saveResets(resets);
    return { ok: false, error: 'Reset code has expired. Please request a new one.' };
  }
  if (entry.code !== code.trim()) return { ok: false, error: 'Incorrect code. Try again.' };
  delete resets[username];
  saveResets(resets);
  return { ok: true };
}

async function resetPassword(username, newPassword) {
  const users = getUsers();
  if (!users[username]) return { ok: false, error: 'User not found.' };
  users[username].passwordHash = await hashPassword(newPassword);
  saveUsers(users);
  return { ok: true };
}

function maskEmail(email) {
  if (!email) return 'your registered email';
  const [user, domain] = email.split('@');
  const masked = user.length <= 2
    ? user[0] + '**'
    : user[0] + '***' + user[user.length - 1];
  return masked + '@' + domain;
}

// ── UI ──────────────────────────────────────────────────────────────────────

const authScreen  = document.getElementById('auth-screen');
const appScreen   = document.getElementById('app-screen');
const userDisplay = document.getElementById('user-display');

function showApp(username) {
  authScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');
  userDisplay.textContent = username;
}

function showAuth() {
  appScreen.classList.add('hidden');
  authScreen.classList.remove('hidden');
  document.getElementById('login-error').textContent = '';
  document.getElementById('register-error').textContent = '';
  document.getElementById('register-success').textContent = '';
}

function switchTab(tab) {
  document.getElementById('forgot-form-section').classList.add('hidden');
  document.getElementById('login-tab').classList.toggle('active', tab === 'login');
  document.getElementById('register-tab').classList.toggle('active', tab === 'register');
  document.getElementById('login-form-section').classList.toggle('hidden', tab !== 'login');
  document.getElementById('register-form-section').classList.toggle('hidden', tab !== 'register');
  if (tab === 'login') document.getElementById('login-error').textContent = '';
  if (tab === 'register') {
    document.getElementById('register-error').textContent = '';
    document.getElementById('register-success').textContent = '';
  }
}

function showForgot() {
  document.getElementById('login-form-section').classList.add('hidden');
  document.getElementById('register-form-section').classList.add('hidden');
  document.getElementById('login-tab').classList.remove('active');
  document.getElementById('register-tab').classList.remove('active');
  document.getElementById('forgot-form-section').classList.remove('hidden');
  // Reset to step 1
  document.getElementById('forgot-step-1').classList.remove('hidden');
  document.getElementById('forgot-step-2').classList.add('hidden');
  document.getElementById('forgot-username').value = '';
  document.getElementById('forgot-step1-error').textContent = '';
}

function showLogin() {
  document.getElementById('forgot-form-section').classList.add('hidden');
  switchTab('login');
}

async function submitForgotStep1() {
  const username = document.getElementById('forgot-username').value.trim();
  const errorEl  = document.getElementById('forgot-step1-error');
  const btn      = document.getElementById('forgot-send-btn');
  errorEl.textContent = '';

  if (!username) { errorEl.textContent = 'Please enter your username.'; return; }

  const result = generateResetCode(username);
  if (!result.ok) { errorEl.textContent = result.error; return; }

  const { code, email } = result;
  let statusMsg = '';

  btn.disabled = true;
  btn.textContent = 'Sending…';

  if (!email) {
    // Account has no email registered (created before v1.0)
    console.info('[Dive Gear] No email on account — showing code on screen.');
    statusMsg = `No email address is registered with this account.<br>Your reset code is: <strong class="reset-code-inline">${code}</strong>`;
  } else if (typeof sendResetEmail !== 'function' || !resetEmailReady()) {
    // EmailJS not loaded or reset template not configured
    console.info('[Dive Gear] EmailJS/reset template not ready — showing code on screen.');
    statusMsg = `Email sending is not set up.<br>Your reset code is: <strong class="reset-code-inline">${code}</strong>`;
  } else {
    try {
      await sendResetEmail(email, username, code);
      statusMsg = `A 6-digit code was sent to <strong>${maskEmail(email)}</strong>. It expires in 15 minutes.`;
    } catch (e) {
      console.warn('[Dive Gear] Reset email send failed:', e);
      statusMsg = `Could not send email (${e?.text || e?.message || 'unknown error'}).<br>Your reset code is: <strong class="reset-code-inline">${code}</strong>`;
    }
  }

  btn.disabled = false;
  btn.textContent = 'Send Reset Code';

  document.getElementById('forgot-sent-msg').innerHTML = statusMsg;
  document.getElementById('forgot-step-1').classList.add('hidden');
  document.getElementById('forgot-step-2').classList.remove('hidden');
  document.getElementById('forgot-code').value = '';
  document.getElementById('forgot-new-password').value = '';
  document.getElementById('forgot-confirm-password').value = '';
  document.getElementById('forgot-step2-error').textContent = '';
}

async function submitForgotStep2() {
  const username   = document.getElementById('forgot-username').value.trim();
  const code       = document.getElementById('forgot-code').value.trim();
  const newPwd     = document.getElementById('forgot-new-password').value;
  const confirmPwd = document.getElementById('forgot-confirm-password').value;
  const errorEl    = document.getElementById('forgot-step2-error');
  errorEl.textContent = '';

  if (!code)              { errorEl.textContent = 'Please enter the reset code.'; return; }
  if (newPwd.length < 6)  { errorEl.textContent = 'Password must be at least 6 characters.'; return; }
  if (newPwd !== confirmPwd) { errorEl.textContent = 'Passwords do not match.'; return; }

  const validation = validateResetCode(username, code);
  if (!validation.ok) { errorEl.textContent = validation.error; return; }

  await resetPassword(username, newPwd);

  showLogin();
  document.getElementById('login-username').value = username;
  const successEl = document.getElementById('login-success');
  if (successEl) {
    successEl.textContent = '✅ Password reset! You can now log in.';
    setTimeout(() => { successEl.textContent = ''; }, 5000);
  }
}

document.getElementById('login-tab').addEventListener('click', () => switchTab('login'));
document.getElementById('register-tab').addEventListener('click', () => switchTab('register'));

document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl  = document.getElementById('login-error');
  errorEl.textContent = '';

  const result = await loginUser(username, password);
  if (!result.ok) {
    errorEl.textContent = result.error;
    return;
  }
  setCurrentUser(username);
  document.getElementById('login-form').reset();
  showApp(username);
  initGear();
});

document.getElementById('register-form').addEventListener('submit', async e => {
  e.preventDefault();
  const username  = document.getElementById('reg-username').value.trim();
  const password  = document.getElementById('reg-password').value;
  const confirm   = document.getElementById('reg-confirm').value;
  const errorEl   = document.getElementById('register-error');
  const successEl = document.getElementById('register-success');
  errorEl.textContent = '';
  successEl.textContent = '';

  const email = document.getElementById('reg-email').value.trim();

  if (username.length < 3) {
    errorEl.textContent = 'Username must be at least 3 characters.';
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errorEl.textContent = 'Please enter a valid email address.';
    return;
  }
  if (password.length < 6) {
    errorEl.textContent = 'Password must be at least 6 characters.';
    return;
  }
  if (password !== confirm) {
    errorEl.textContent = 'Passwords do not match.';
    return;
  }

  const result = await registerUser(username, password, email);
  if (!result.ok) {
    errorEl.textContent = result.error;
    return;
  }
  document.getElementById('register-form').reset();
  successEl.textContent = '✅ Account created! You can now log in.';
  setTimeout(() => {
    switchTab('login');
    document.getElementById('login-username').value = username;
    document.getElementById('login-password').value = '';
  }, 1500);
});

document.getElementById('logout-btn').addEventListener('click', () => {
  clearSession();
  showAuth();
});

// ── Init ─────────────────────────────────────────────────────────────────────

const existing = getCurrentUser();
if (existing) {
  showApp(existing);
  initGear();
} else {
  showAuth();
}
