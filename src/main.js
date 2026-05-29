// Entry point: handles login flow and starts the app
import * as DB from './db.js';
import { startApp } from './app.js';

const loginScreen = document.getElementById('loginScreen');
const appScreen = document.getElementById('appScreen');
const loginForm = document.getElementById('loginForm');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');
const logoutBtn = document.getElementById('logoutBtn');

function showLogin() {
  loginScreen.style.display = 'flex';
  appScreen.style.display = 'none';
}

function showApp() {
  loginScreen.style.display = 'none';
  appScreen.style.display = 'flex';
}

async function init() {
  try {
    DB.initSupabase();
  } catch (err) {
    loginError.textContent = err.message;
    showLogin();
    return;
  }

  // Check for existing session
  const session = await DB.getSession();
  if (session) {
    showApp();
    await startApp();
  } else {
    showLogin();
  }
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  loginBtn.disabled = true;
  loginBtn.textContent = 'Signing in…';

  const fd = new FormData(loginForm);
  try {
    await DB.signIn(fd.get('email'), fd.get('password'));
    showApp();
    await startApp();
  } catch (err) {
    loginError.textContent = err.message || 'Login failed';
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign in';
  }
});

logoutBtn.addEventListener('click', async () => {
  if (!confirm('Sign out?')) return;
  await DB.signOut();
  location.reload();
});

init();
