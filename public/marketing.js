// SAVRO public homepage behaviour.
// Keep the SEO homepage public for visitors and search engines, but send a
// returning customer with a valid saved session straight to the bookkeeping app.
(async function redirectReturningCustomer() {
  let token = null;

  try {
    token = localStorage.getItem('ledgerly_token');
  } catch {
    // If browser storage is unavailable, leave the public homepage usable.
    return;
  }

  if (!token) return;

  try {
    const response = await fetch('/api/auth/me', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      credentials: 'same-origin'
    });

    if (response.ok) {
      window.location.replace('/app/');
      return;
    }

    // Remove only a session the server has explicitly rejected.
    if (response.status === 401 || response.status === 403) {
      localStorage.removeItem('ledgerly_token');
    }
    // For server errors, keep the token and let the homepage remain available.
  } catch {
    // Network/offline errors should not destroy a potentially valid session.
  }
})();

const menuToggle = document.getElementById('menuToggle');
const mainNav = document.getElementById('mainNav');

if (menuToggle && mainNav) {
  menuToggle.addEventListener('click', () => {
    const open = mainNav.classList.toggle('open');
    menuToggle.setAttribute('aria-expanded', String(open));
  });

  mainNav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    mainNav.classList.remove('open');
    menuToggle.setAttribute('aria-expanded', 'false');
  }));
}

const year = document.getElementById('year');
if (year) year.textContent = new Date().getFullYear();
