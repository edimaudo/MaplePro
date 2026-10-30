(() => {
  const form = document.getElementById('login-form');
  const email = document.getElementById('email');
  const password = document.getElementById('password');
  const errorBox = document.getElementById('login-error');
  const submit = document.getElementById('login-submit');
  const pills = [...document.querySelectorAll('.role-pill')];
  const roleHelp = document.getElementById('role-help');
  let config = { auth_mode: 'demo' };
  let supabaseClient = null;

  fetch('/api/config').then(r => r.json()).then(value => {
    config = value;
    if (config.auth_mode === 'supabase' && window.supabase) {
      document.body.classList.remove('role-login');
      supabaseClient = window.supabase.createClient(config.supabase_url, config.supabase_anon_key);
      roleHelp.hidden = true;
      email.value = ''; password.value = ''; 
      pills.forEach(p => p.hidden = true);
      document.querySelector('.role-divider').hidden = true;
    } else if (config.auth_mode === 'demo') {
      document.body.classList.add('role-login');
      const selected = pills.find(pill => pill.classList.contains('selected')) || pills[0];
      if (selected) { email.value = selected.dataset.email; password.value = 'MaplePro2026!'; }
    } else {
      document.body.classList.remove('role-login');
      roleHelp.hidden = true;
    }
  }).catch(() => {});

  pills.forEach(pill => pill.addEventListener('click', () => {
    pills.forEach(p => p.classList.toggle('selected', p === pill));
    email.value = pill.dataset.email;
    password.value = 'MaplePro2026!';
    errorBox.hidden = true;
    submit.focus();
  }));

  document.getElementById('toggle-password').addEventListener('click', () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    document.getElementById('toggle-password').textContent = show ? 'Hide' : 'Show';
    document.getElementById('toggle-password').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    errorBox.hidden = true;
    submit.disabled = true;
    submit.innerHTML = 'Signing in <span class="button-spinner"></span>';
    try {
      let token;
      if (config.auth_mode === 'demo') {
        const response = await fetch('/api/auth/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.value.trim().toLowerCase(), password: password.value })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || 'Unable to sign in.');
        token = result.access_token;
      } else if (config.auth_mode === 'supabase' && supabaseClient) {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
        if (error) throw error;
        token = data.session?.access_token;
        if (data.session?.refresh_token) sessionStorage.setItem('maplepro_refresh_token', data.session.refresh_token);
        if (!token) throw new Error('Supabase did not return an active session.');
      } else {
        throw new Error('Authentication is not configured. Contact the workspace administrator.');
      }
      sessionStorage.setItem('maplepro_token', token);
      window.location.href = '/app';
    } catch (error) {
      errorBox.textContent = error.message || 'Unable to sign in. Verify your details and try again.';
      errorBox.hidden = false;
    } finally {
      submit.disabled = false;
      submit.innerHTML = 'Sign in <span aria-hidden="true">→</span>';
    }
  });
})();
