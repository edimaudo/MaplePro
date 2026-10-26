(() => {
  const token = sessionStorage.getItem('maplepro_token');
  if (!token) { window.location.replace('/login'); return; }

  const shell = document.getElementById('app-shell');
  const viewRoot = document.getElementById('view-root');
  const toastRegion = document.getElementById('toast-region');
  const invoiceDialog = document.getElementById('invoice-dialog');
  const projectDialog = document.getElementById('project-dialog');
  const searchInput = document.getElementById('global-search');
  const searchPopover = document.getElementById('search-popover');
  const state = { config: {}, dashboard: null, user: null, view: 'overview', intelligence: null, searchTimer: null, projectFilter: 'all', invoiceFilter: 'all' };

  const money = value => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(Number(value || 0));
  const money2 = value => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));
  const pct = value => `${Math.round(Number(value || 0))}%`;
  const shortDate = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : '—';
  const fullDate = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  const cap = value => String(value || '').replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
  const initials = name => String(name || 'MP').split(/\s+/).slice(0,2).map(part => part[0] || '').join('').toUpperCase();
  const roleLabel = role => ({ admin: 'Administrator', project_manager: 'Project Manager', client: 'Client', subcontractor: 'Subcontractor' }[role] || cap(role));
  const projectById = id => state.dashboard?.projects.find(p => p.id === id);

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}), Authorization: `Bearer ${sessionStorage.getItem('maplepro_token') || ''}` };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, { ...options, headers });
    let payload = {};
    try { payload = await response.json(); } catch (_) {}
    if (response.status === 401) { sessionStorage.removeItem('maplepro_token'); window.location.replace('/login'); throw new Error('Your session expired. Sign in again.'); }
    if (!response.ok) throw new Error(payload.detail || `Request failed (${response.status}).`);
    return payload;
  }

  function showToast(title, message, isError = false) {
    const toast = document.createElement('div');
    toast.className = `toast${isError ? ' error' : ''}`;
    toast.innerHTML = `<span class="toast-icon">${isError ? '!' : '✓'}</span><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p></div>`;
    toastRegion.appendChild(toast);
    setTimeout(() => toast.remove(), 4800);
  }

  function setTheme(theme) {
    shell.dataset.theme = theme;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('maplepro_theme', theme);
    document.getElementById('theme-icon').textContent = theme === 'dark' ? '☼' : '◐';
  }

  function applyUser(user) {
    state.user = user;
    document.getElementById('sidebar-avatar').textContent = initials(user.name);
    document.getElementById('topbar-avatar').textContent = initials(user.name);
    document.getElementById('sidebar-name').textContent = user.name;
    document.getElementById('sidebar-role').textContent = roleLabel(user.role);
    document.getElementById('nav-risk-count').textContent = state.dashboard?.stats.high_risk_projects ?? '—';
    document.getElementById('nav-invoice-dot').hidden = !(state.dashboard?.stats.overdue_invoice_count > 0);
    document.getElementById('footer-mode').textContent = state.config.demo_mode ? 'Seeded demonstration workspace' : 'Connected workspace';
    const status = document.getElementById('integration-status');
    if (state.config.paypal_configured) status.innerHTML = '<span class="status-pip connected"></span><span>PayPal Sandbox connected</span>';
    else status.innerHTML = '<span class="status-pip"></span><span>Demo environment</span>';
    document.querySelectorAll('.nav-item[data-view="team"]').forEach(el => { el.hidden = user.role !== 'admin'; });
  }

  function pageHeader(kicker, title, subtitle, actions = '') {
    return `<div class="page-heading"><div><div class="page-kicker">${escapeHtml(kicker)}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div><div class="page-heading-actions">${actions}</div></div>`;
  }

  function statusPill(status) {
    const normalized = String(status || '').toLowerCase().replace(/\s+/g, '-');
    const cls = ['paid','complete','sent','upcoming','in-progress','overdue','at-risk','draft'].includes(normalized) ? normalized : 'draft';
    return `<span class="status-pill ${cls}">${escapeHtml(cap(status))}</span>`;
  }

  function riskChip(level) {
    const normalized = String(level || 'low').toLowerCase();
    return `<span class="risk-chip ${escapeHtml(normalized)}">${escapeHtml(level)} risk</span>`;
  }

  function insightCardHTML(insight, compact = false) {
    const project = projectById(insight.project_id);
    const projectName = insight.project_name || project?.name || 'Project intelligence';
    const priority = String(insight.priority || 'This week').toLowerCase();
    const priorityClass = priority.includes('urgent') ? '' : priority.includes('today') ? 'today' : 'week';
    const markerClass = String(insight.risk_level || '').toLowerCase() === 'high' ? 'urgent' : String(insight.risk_level || '').toLowerCase() === 'medium' ? 'medium' : 'low';
    const headline = insight.headline || insight.recommended_action || 'Project risk signal detected';
    const description = insight.explanation || insight.action_detail || 'Review the project signals and confirm the next action.';
    const action = insight.recommendation || insight.recommended_action || 'Review project signals';
    const source = insight.ai_generated ? 'Gemini Flash' : 'Rule-based signal';
    const confidence = insight.confidence_score ? `<div class="confidence-note"><strong>${escapeHtml(insight.confidence_score)}% signal confidence</strong> · based on data completeness, not a failure probability</div>` : '';
    const button = insight.invoice_id ? `<button class="insight-action" data-action="remind" data-id="${escapeHtml(insight.invoice_id)}"><span>${escapeHtml(action)}</span><span>→</span></button>` : `<button class="insight-action" data-action="view-project" data-id="${escapeHtml(insight.project_id || '')}"><span>${escapeHtml(action)}</span><span>→</span></button>`;
    return `<article class="insight-card${compact ? ' compact' : ''}"><div class="insight-marker ${markerClass}">${markerClass === 'urgent' ? '!' : markerClass === 'medium' ? '↗' : '✓'}</div><div class="insight-body"><div class="insight-topline"><h3>${escapeHtml(headline)}</h3><span class="priority-label ${priorityClass}">${escapeHtml(priority)}</span></div><p class="insight-project">${escapeHtml(projectName)} · ${escapeHtml(source)}</p><p class="insight-explanation">${escapeHtml(description)}</p>${button}${confidence}</div></article>`;
  }

  function renderStats(stats) {
    return `<div class="stats-grid">
      <article class="stat-card"><div class="stat-card-top"><span class="stat-label">Active projects</span><span class="stat-icon">▦</span></div><div class="stat-value">${String(stats.active_projects).padStart(2,'0')}</div><div class="stat-bottom"><span class="stat-trend">${stats.high_risk_projects} at elevated risk</span><span>· across your portfolio</span></div></article>
      <article class="stat-card stat-danger"><div class="stat-card-top"><span class="stat-label">High-risk projects</span><span class="stat-icon">⌁</span></div><div class="stat-value">${String(stats.high_risk_projects).padStart(2,'0')}</div><div class="stat-bottom"><span class="stat-trend warning">Action required</span><span>· rule-based risk index</span></div></article>
      <article class="stat-card"><div class="stat-card-top"><span class="stat-label">Outstanding receivables</span><span class="stat-icon">$</span></div><div class="stat-value">${money(stats.outstanding_invoices)}</div><div class="stat-bottom"><span class="stat-trend warning">${money(stats.overdue_invoice_value)} overdue</span><span>· client invoices</span></div></article>
      <article class="stat-card"><div class="stat-card-top"><span class="stat-label">Portfolio progress</span><span class="stat-icon">◷</span></div><div class="stat-value">${pct(stats.avg_progress)}</div><div class="stat-bottom"><span>Current recorded completion</span></div></article>
    </div>`;
  }

  function renderPortfolio(projects, small = false) {
    const items = [...projects].sort((a,b) => b.risk_score - a.risk_score).slice(0, small ? 4 : 20);
    if (!items.length) return '<div class="empty-state"><strong>No projects in this view</strong>Your role does not currently have project assignments in this workspace.</div>';
    return `<div class="portfolio-health">${small ? '' : `<div class="portfolio-summary"><span><b>${projects.length} projects</b> in this workspace</span><span>Sorted by highest risk</span></div>`}${items.map(p => `<div class="health-row"><button class="health-project-button" data-action="view-project" data-id="${escapeHtml(p.id)}"><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.code)} · ${escapeHtml(p.stage)}</small></button><div class="progress-track" aria-label="${pct(p.progress_pct)} complete"><span style="width:${Math.min(100,Math.max(0,p.progress_pct))}%"></span></div><span class="project-progress">${pct(p.progress_pct)}</span>${riskChip(p.risk_level)}</div>`).join('')}</div>`;
  }

  function renderCashBars(invoices) {
    const months = [];
    const today = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const label = d.toLocaleDateString('en-CA', { month: 'short' });
      months.push({ label, year: d.getFullYear(), month: d.getMonth(), total: 0 });
    }
    invoices.filter(inv => inv.status === 'PAID').forEach(inv => {
      const d = new Date(`${inv.issued_date}T12:00:00`);
      const found = months.find(m => m.year === d.getFullYear() && m.month === d.getMonth());
      if (found) found.total += Number(inv.amount || 0);
    });
    const max = Math.max(1, ...months.map(m => m.total));
    return `<div class="cash-bars">${months.map((m,i) => `<div class="cash-month"><div class="cash-month-bar ${i === months.length - 1 ? 'current' : ''}" style="height:${Math.max(8, (m.total/max)*72)}%" title="${escapeHtml(m.label)} · ${money(m.total)}"></div><small>${escapeHtml(m.label)}</small></div>`).join('')}</div>`;
  }

  function renderMilestones(milestones) {
    if (!milestones.length) return '<div class="empty-state">No upcoming milestones in this view.</div>';
    return `<div class="milestone-list">${milestones.slice(0,6).map(m => `<div class="milestone-row"><span class="milestone-icon ${m.status === 'At risk' ? 'warn' : ''}">${m.status === 'At risk' ? '!' : '◷'}</span><div><strong>${escapeHtml(m.title)}</strong><small>${escapeHtml(m.project_name)}</small></div><span class="milestone-date">${shortDate(m.planned_date)}</span></div>`).join('')}</div>`;
  }

  function renderInvoiceTable(invoices, options = {}) {
    const showProject = options.showProject !== false;
    const empty = '<div class="empty-state"><strong>No invoices to show</strong>Invoices that are visible to your role will appear here.</div>';
    if (!invoices.length) return empty;
    return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Invoice</th>${showProject ? '<th>Project</th>' : ''}<th>Bill to</th><th>Due date</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead><tbody>${invoices.map(i => {
      let action = '';
      if (state.user.role === 'admin' || state.user.role === 'project_manager') {
        if (i.status !== 'PAID') action += `<button class="table-action warn" data-action="remind" data-id="${escapeHtml(i.id)}">Remind</button>`;
        if (i.paypal_view_url) action += ` <button class="table-action" data-action="open-invoice" data-url="${escapeHtml(i.paypal_view_url)}">Open</button>`;
      }
      if (state.config.demo_mode && i.status !== 'PAID' && ['admin','project_manager','client'].includes(state.user.role)) action += ` <button class="table-action" data-action="simulate-payment" data-id="${escapeHtml(i.id)}">Simulate</button>`;
      if (i.status === 'PAID') action = `<span class="table-secondary">${i.paid_at ? `Paid ${shortDate(i.paid_at.slice(0,10))}` : 'Settled'}</span>`;
      if (!action) action = '<span class="table-secondary">View only</span>';
      return `<tr data-invoice-row="${escapeHtml(i.id)}"><td><span class="table-primary">${escapeHtml(i.invoice_number)}</span><span class="table-secondary">${escapeHtml(i.description)}</span></td>${showProject ? `<td><span class="table-primary">${escapeHtml(i.project_name)}</span></td>` : ''}<td><span class="table-primary">${escapeHtml(i.recipient_name)}</span><span class="table-secondary">${escapeHtml(i.recipient_email)}</span></td><td><span class="table-primary">${shortDate(i.due_date)}</span><span class="table-secondary">${i.status !== 'PAID' && i.overdue_days ? `${i.overdue_days} days overdue` : `Issued ${shortDate(i.issued_date)}`}</span></td><td><span class="table-primary">${money2(i.amount)}</span><span class="table-secondary">${escapeHtml(i.currency_code)}</span></td><td>${statusPill(i.status)}</td><td><div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">${action}</div></td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function renderOverview() {
    const d = state.dashboard;
    const insights = state.intelligence?.insights || d.insights;
    return `${pageHeader(new Date().toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase(), `Good morning, ${state.user.name.split(' ')[0]}`, 'Here is what needs your attention across the projects you can access.', `<button class="button button-quiet" data-action="refresh-dashboard">↻ Refresh</button>${['admin','project_manager'].includes(state.user.role) ? '<button class="button button-primary" data-action="new-invoice">＋ New invoice</button>' : ''}`)}
      ${state.config.demo_mode ? `<div class="data-banner" style="margin-bottom:15px"><span>ⓘ</span><span>Seeded demo data · Forecasts use synthetic monthly snapshots. PayPal actions are simulated until Sandbox credentials are configured.</span></div>` : ''}
      ${renderStats(d.stats)}
      <div class="overview-grid"><div>
        <section class="panel"><div class="panel-header"><div><h2 class="panel-title">Priority intelligence</h2><p class="panel-subtitle">Signals ranked by urgency and business impact</p></div><button class="panel-link" data-view="intelligence">See all insights →</button></div><div class="intelligence-list">${insights.length ? insights.slice(0,4).map(i => insightCardHTML(i, true)).join('') : '<div class="empty-state"><strong>No priority signals</strong>There are no elevated signals in your current view.</div>'}</div></section>
        <section class="panel portfolio-panel"><div class="panel-header"><div><h2 class="panel-title">Project health</h2><p class="panel-subtitle">Recorded progress and rule-based risk index</p></div><button class="panel-link" data-view="projects">All projects →</button></div>${renderPortfolio(d.projects, true)}</section>
      </div><div class="right-column">
        <section class="cash-card"><div class="panel-header"><div><h2 class="panel-title">Cash collected</h2><p class="panel-subtitle">Paid invoice records by issue month</p></div><button class="panel-link" data-view="invoices">Invoices →</button></div><div class="cash-value">${money(d.invoices.filter(i => i.status === 'PAID').reduce((sum,i) => sum + Number(i.amount),0))}</div><div class="cash-caption">From invoices in your current view</div>${renderCashBars(d.invoices)}<div class="cash-legend"><span><i></i> Recorded paid invoices</span><span>CAD</span></div></section>
        <section class="panel"><div class="panel-header"><div><h2 class="panel-title">Upcoming milestones</h2><p class="panel-subtitle">Next scheduled project checkpoints</p></div><button class="panel-link" data-view="projects">View projects →</button></div>${renderMilestones(d.milestones)}</section>
      </div></div>
      <section class="panel" style="margin-top:17px"><div class="panel-header"><div><h2 class="panel-title">Recent invoices</h2><p class="panel-subtitle">Keep payment activity visible alongside delivery risk.</p></div><button class="panel-link" data-view="invoices">Manage invoices →</button></div>${renderInvoiceTable([...d.invoices].sort((a,b) => (b.overdue_days || 0) - (a.overdue_days || 0)).slice(0,5), {showProject:true})}</section>`;
  }

  function renderProjects() {
    const d = state.dashboard;
    const sorted = [...d.projects].sort((a,b) => b.risk_score - a.risk_score);
    const filtered = state.projectFilter === 'all' ? sorted : sorted.filter(p => p.risk_level.toLowerCase() === state.projectFilter);
    const filter = `<select class="filter-select" id="project-risk-filter" aria-label="Filter projects by risk"><option value="all" ${state.projectFilter==='all'?'selected':''}>All risk levels</option><option value="high" ${state.projectFilter==='high'?'selected':''}>High risk</option><option value="medium" ${state.projectFilter==='medium'?'selected':''}>Medium risk</option><option value="low" ${state.projectFilter==='low'?'selected':''}>Low risk</option></select>`;
    return `${pageHeader('PROJECT PORTFOLIO', 'Projects', 'Monitor delivery progress, projected final cost, and forecast completion.', `${['admin','project_manager'].includes(state.user.role) ? '<button class="button button-primary" data-action="new-invoice">＋ New invoice</button>' : ''}`)}<section class="panel"><div class="panel-header"><div><h2 class="panel-title">All accessible projects</h2><p class="panel-subtitle">${d.projects.length} projects · forecasts are based on seeded monthly snapshots</p></div>${filter}</div>${filtered.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Project</th><th>Client</th><th>Budget</th><th>Actual cost</th><th>Progress</th><th>Forecast variance</th><th>Schedule outlook</th><th>Risk</th></tr></thead><tbody>${filtered.map(p=>`<tr><td><button class="health-project-button" data-action="view-project" data-id="${escapeHtml(p.id)}"><span class="table-primary">${escapeHtml(p.name)}</span><span class="table-secondary">${escapeHtml(p.code)} · ${escapeHtml(p.stage)}</span></button></td><td>${escapeHtml(p.client_name)}</td><td>${money(p.budget)}</td><td>${money(p.actual_cost)}</td><td><div style="display:flex;align-items:center;gap:7px;min-width:84px"><div class="progress-track" style="flex:1"><span style="width:${Math.min(100,p.progress_pct)}%"></span></div><span>${pct(p.progress_pct)}</span></div></td><td><span class="table-primary" style="color:${p.projected_variance_pct>5?'var(--app-orange)':'var(--app-green)'}">${p.projected_variance_pct>0?'+':''}${p.projected_variance_pct.toFixed(1)}%</span><span class="table-secondary">${money(p.projected_final_cost)} forecast</span></td><td><span class="table-primary">${shortDate(p.predicted_finish)}</span><span class="table-secondary">${p.schedule_slip_days>0?`${p.schedule_slip_days}d after target`:'Within current target'}</span></td><td>${riskChip(p.risk_level)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state">No projects match this risk filter.</div>'}</section><div style="margin-top:14px">${state.config.demo_mode ? '<div class="data-banner"><span>ⓘ</span><span>Projected cost and completion date are trend-based estimates using synthetic snapshots. Validate them against current commitments and the live schedule before making decisions.</span></div>' : ''}</div>`;
  }

  function renderInvoices() {
    const d = state.dashboard;
    const roleCanCreate = ['admin','project_manager'].includes(state.user.role);
    let invoices = [...d.invoices];
    if (state.invoiceFilter === 'unpaid') invoices = invoices.filter(i => i.status !== 'PAID');
    if (state.invoiceFilter === 'overdue') invoices = invoices.filter(i => i.status !== 'PAID' && i.overdue_days > 0);
    if (state.invoiceFilter === 'paid') invoices = invoices.filter(i => i.status === 'PAID');
    const filter = `<select class="filter-select" id="invoice-status-filter" aria-label="Filter invoices"><option value="all" ${state.invoiceFilter==='all'?'selected':''}>All invoices</option><option value="overdue" ${state.invoiceFilter==='overdue'?'selected':''}>Overdue</option><option value="unpaid" ${state.invoiceFilter==='unpaid'?'selected':''}>Outstanding</option><option value="paid" ${state.invoiceFilter==='paid'?'selected':''}>Paid</option></select>`;
    const totalOutstanding = d.invoices.filter(i=>i.status!=='PAID' && i.invoice_type==='client_invoice').reduce((sum,i)=>sum+Number(i.amount),0);
    return `${pageHeader('CASH FLOW', 'Invoices & payments', 'Create invoices, follow up on outstanding balances, and reconcile payment status.', `${roleCanCreate ? '<button class="button button-primary" data-action="new-invoice">＋ Create invoice</button>' : ''}`)}
      <div class="stats-grid"><article class="stat-card"><div class="stat-card-top"><span class="stat-label">Outstanding amount</span><span class="stat-icon">$</span></div><div class="stat-value">${money(totalOutstanding)}</div><div class="stat-bottom">Unpaid client invoice records</div></article><article class="stat-card stat-danger"><div class="stat-card-top"><span class="stat-label">Overdue amount</span><span class="stat-icon">!</span></div><div class="stat-value">${money(d.stats.overdue_invoice_value)}</div><div class="stat-bottom">${d.stats.overdue_invoice_count} invoices past due</div></article><article class="stat-card"><div class="stat-card-top"><span class="stat-label">Paid invoice records</span><span class="stat-icon">✓</span></div><div class="stat-value">${d.invoices.filter(i=>i.status==='PAID').length}</div><div class="stat-bottom">Payment state from local records</div></article><article class="stat-card"><div class="stat-card-top"><span class="stat-label">PayPal integration</span><span class="stat-icon">↗</span></div><div class="stat-value" style="font-size:19px">${state.config.paypal_configured?'Connected':'Not connected'}</div><div class="stat-bottom">${state.config.paypal_configured?'Sandbox API credentials found':'Configure Sandbox credentials to send actual invoices'}</div></article></div>
      <section class="panel"><div class="panel-header"><div><h2 class="panel-title">Invoice register</h2><p class="panel-subtitle">${d.invoices.length} invoice records visible to your role</p></div>${filter}</div>${renderInvoiceTable(invoices)}<div class="list-toolbar"><p>${state.config.demo_mode ? 'Demo actions are clearly marked and do not contact a customer.' : 'Payment changes are driven by verified provider events.'}</p></div></section>`;
  }

  function renderIntelligence() {
    const d = state.dashboard;
    const intel = state.intelligence || { mode:'rules_fallback', ai_generated:false, executive_summary: state.config.gemini_configured ? 'Refresh to generate current Gemini Flash explanations from the project evidence.' : 'Gemini is not connected. The signals below are calculated using deterministic rules and a trend-based forecast.', insights:d.insights, notice: state.config.gemini_configured ? 'Gemini is configured.' : 'Add GEMINI_API_KEY to .env to enable Gemini Flash narratives.' };
    const action = `<button class="button button-primary" data-action="refresh-ai" ${!state.config.gemini_configured?'title="Gemini API key not configured; this will return rule-based fallback insights"':''}>✦ ${state.config.gemini_configured ? 'Generate with Gemini Flash' : 'Refresh intelligence'}</button>`;
    return `${pageHeader('DECISION SUPPORT', 'AI intelligence', 'A transparent mix of deterministic rules, trend-based forecasts, and Gemini-generated context.', action)}
      <section class="intelligence-hero"><div><div class="page-kicker">EXECUTIVE BRIEF · ${intel.ai_generated ? escapeHtml(intel.model || state.config.gemini_model) : 'RULE-BASED FALLBACK'}</div><h2>${intel.ai_generated ? 'The current picture, explained.' : 'Start with the evidence.'}</h2><p>${escapeHtml(intel.executive_summary || 'Review the strongest project signals below.')}</p><p style="margin-top:8px;font-size:8px;color:var(--app-muted)">${escapeHtml(intel.notice || 'Numbers are calculated by the MaplePro risk engine; Gemini generates explanations only.')}</p></div><div class="stat-icon" style="width:48px;height:48px;font-size:22px">✳</div></section>
      <div class="intelligence-grid">${(intel.insights || []).length ? intel.insights.map(i => `<article class="intelligence-feature-card">${insightCardHTML(i)}<div class="recommendation-block"><b>RECOMMENDED NEXT STEP</b>${escapeHtml(i.recommendation || i.recommended_action || i.action_detail || 'Review the project details and confirm the next action.')}</div></article>`).join('') : '<section class="panel"><div class="empty-state"><strong>No elevated signals detected</strong>Rule-based indicators did not cross the configured thresholds for your current view.</div></section>'}</div>
      <div class="data-banner" style="margin-top:15px"><span>ⓘ</span><span>Risk scores are deterministic indices, not probabilities of project failure. Forecasts are estimates produced from six seeded monthly snapshots per project. Gemini must not generate or modify the financial figures.</span></div>`;
  }

  function renderReports() {
    const projects = [...state.dashboard.projects].sort((a,b) => b.projected_variance_pct - a.projected_variance_pct);
    const highCount = projects.filter(p=>p.projected_variance_pct>7).length;
    const max = Math.max(1, ...projects.map(p=>p.projected_final_cost));
    return `${pageHeader('FORECASTS & ANALYTICS', 'Forecasts & reports', 'Trend-based cost-to-complete estimates and schedule outlooks, backed by seeded monthly snapshots.', '<button class="button button-quiet" data-action="refresh-dashboard">↻ Recalculate</button>')}
      <div class="section-grid"><section class="panel"><div class="panel-header"><div><h2 class="panel-title">Forecast final cost by project</h2><p class="panel-subtitle">Current cost vs projected cost at completion</p></div><span class="priority-count">${highCount} above 7% variance</span></div><div class="forecast-chart"><div class="forecast-legend"><span><i></i> Current actual cost</span><span><i class="plan"></i> Forecast final cost</span></div>${projects.map(p=>`<div class="forecast-row"><div class="forecast-project"><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.code)} · budget ${money(p.budget)}</small></div><div class="forecast-stacks"><div class="forecast-stack"><span class="actual" style="width:${Math.min(100,p.actual_cost/max*100)}%"></span></div><div class="forecast-stack"><span class="forecast" style="width:${Math.min(100,p.projected_final_cost/max*100)}%"></span></div></div><div class="forecast-value">${money(p.projected_final_cost)}<small>${p.projected_variance_pct>0?'+':''}${p.projected_variance_pct.toFixed(1)}%</small></div></div>`).join('')}</div></section>
      <aside class="info-callout"><div class="page-kicker">HOW TO READ THIS</div><h3>Forecast ≠ certainty</h3><p>MaplePro projects final cost from cost-to-progress ratios and committed costs. Schedule estimates extrapolate observed progress velocity across synthetic monthly snapshots. The methods are intentionally simple and explainable for this prototype.</p><div class="info-metric"><span>Projects included</span><strong>${projects.length}</strong></div><div class="info-metric"><span>Average progress</span><strong>${pct(state.dashboard.stats.avg_progress)}</strong></div><div class="info-metric"><span>Elevated risk</span><strong>${state.dashboard.stats.high_risk_projects}</strong></div><div class="info-metric"><span>Historical data source</span><strong>Synthetic demo records</strong></div></aside></div>
      <section class="panel" style="margin-top:16px"><div class="panel-header"><div><h2 class="panel-title">Schedule outlook</h2><p class="panel-subtitle">Predicted finish dates compared with current targets</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Project</th><th>Progress</th><th>Target finish</th><th>Estimated finish</th><th>Schedule variance</th><th>Signal confidence</th></tr></thead><tbody>${[...projects].sort((a,b)=>b.schedule_slip_days-a.schedule_slip_days).map(p=>`<tr><td><span class="table-primary">${escapeHtml(p.name)}</span><span class="table-secondary">${escapeHtml(p.code)}</span></td><td>${pct(p.progress_pct)}</td><td>${fullDate(p.target_completion)}</td><td>${fullDate(p.predicted_finish)}</td><td><span class="table-primary" style="color:${p.schedule_slip_days>10?'var(--app-orange)':'var(--app-green)'}">${p.schedule_slip_days>0?`+${p.schedule_slip_days} days`:`${p.schedule_slip_days} days`}</span></td><td>${p.confidence_score}%</td></tr>`).join('')}</tbody></table></div></section>`;
  }

  function renderTeam() {
    if (state.user.role !== 'admin') return `${pageHeader('ACCESS CONTROL', 'People & access', 'Your current role has project-level access only.', '')}<section class="panel"><div class="empty-state"><strong>Administrator access required</strong>Ask a firm administrator to manage workspace membership.</div></section>`;
    const users = [
      ['Alex Morgan','admin@maplepro.demo','Administrator','AM','role-avatar-dark'],['Olivia Chen','manager@maplepro.demo','Project Manager','OC','role-avatar-green'],['Jordan Blake','client@maplepro.demo','Client','JB','role-avatar-blue'],['Sam Patel','subcontractor@maplepro.demo','Subcontractor','SP','role-avatar-sand']
    ];
    return `${pageHeader('ACCESS CONTROL', 'People & access', 'Four demo personas cover firm administration, delivery, client transparency, and trade payment visibility.', '')}<div class="data-banner" style="margin-bottom:15px"><span>ⓘ</span><span>Demo identities exist for evaluation. In a connected Supabase environment, create Auth users and map each auth user ID to an authorized firm profile before sign-in.</span></div><div class="team-grid">${users.map(u=>`<article class="team-card"><span class="role-avatar ${u[4]}">${u[3]}</span><h3>${escapeHtml(u[0])}</h3><p>${escapeHtml(u[1])}</p><span class="status-pill complete">${escapeHtml(u[2])}</span></article>`).join('')}</div><section class="panel" style="margin-top:16px"><div class="panel-header"><div><h2 class="panel-title">Authorization model</h2><p class="panel-subtitle">UI controls supplement API-side checks and firm-scoped data access.</p></div></div><div class="settings-list"><div class="settings-row"><div><strong>Administrator</strong><p>Firm-wide projects, invoices, analytics, and role visibility.</p></div><span class="settings-value">Full firm scope</span></div><div class="settings-row"><div><strong>Project manager</strong><p>Project oversight and invoice workflow for the firm.</p></div><span class="settings-value">Operational scope</span></div><div class="settings-row"><div><strong>Client</strong><p>Projects and client invoices addressed to that account.</p></div><span class="settings-value">Client email scope</span></div><div class="settings-row"><div><strong>Subcontractor</strong><p>Assigned projects and its own subcontractor invoice records.</p></div><span class="settings-value">Assignment scope</span></div></div></section>`;
  }

  function renderSettings() {
    const c = state.dashboard.integrations;
    const row = (title, desc, value, good) => `<div class="settings-row"><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(desc)}</p></div><div class="settings-value"><strong style="color:${good?'var(--app-green)':'var(--app-orange)'}">${escapeHtml(value)}</strong></div></div>`;
    return `${pageHeader('WORKSPACE SETTINGS', 'Settings', 'Integration readiness and current prototype configuration.', '')}<section class="panel"><div class="panel-header"><div><h2 class="panel-title">Integrations</h2><p class="panel-subtitle">Secrets remain server-side and are never returned to the browser.</p></div></div><div class="settings-list">${row('Gemini Flash','Contextual explanation and recommended actions',c.gemini_configured?c.gemini_model+' connected':'API key not configured',c.gemini_configured)}${row('PayPal Invoicing v2','Create invoices, send reminders, and retrieve payer links',c.paypal_configured?'Sandbox credentials configured':'Sandbox credentials not configured',c.paypal_configured)}${row('Supabase Auth','JWT verification and firm-scoped profiles',c.supabase_auth?'Configured':'Demo authentication',c.supabase_auth)}${row('Database','Project, invoice, milestone, and snapshot storage',state.config.demo_mode?'Local SQLite':'Configured database',true)}</div></section><section class="panel" style="margin-top:15px"><div class="panel-header"><div><h2 class="panel-title">Prototype guardrails</h2><p class="panel-subtitle">Assumptions documented for judge evaluation</p></div></div><div class="settings-list">${row('Predictive analytics','Trend extrapolation based on synthetic monthly snapshots','Estimates only',false)}${row('Rule-based scores','Transparent thresholds applied in Python','Deterministic index',true)}${row('Demo payment action','Local invoice state update, not a provider transaction',c.demo_mode?'Simulation only':'Disabled',!c.demo_mode)}${row('Fraud / Pay Later','Excluded from the initial three-capability integration scope','Deferred',false)}</div></section><div class="data-banner" style="margin-top:15px"><span>ⓘ</span><span>See README.md and supabase/schema.sql for setup instructions, tenant isolation policies, and known limitations.</span></div>`;
  }

  function renderView() {
    document.querySelectorAll('.nav-item[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === state.view));
    const label = ({ overview:'Command center', projects:'Projects', invoices:'Invoices & payments', intelligence:'AI intelligence', reports:'Forecasts & reports', team:'People & access', settings:'Settings' })[state.view] || 'Command center';
    document.getElementById('breadcrumb-current').textContent = label;
    switch (state.view) {
      case 'projects': viewRoot.innerHTML = renderProjects(); break;
      case 'invoices': viewRoot.innerHTML = renderInvoices(); break;
      case 'intelligence': viewRoot.innerHTML = renderIntelligence(); break;
      case 'reports': viewRoot.innerHTML = renderReports(); break;
      case 'team': viewRoot.innerHTML = renderTeam(); break;
      case 'settings': viewRoot.innerHTML = renderSettings(); break;
      default: viewRoot.innerHTML = renderOverview();
    }
  }

  async function reloadDashboard(showNotice = false) {
    const d = await api('/api/dashboard');
    state.dashboard = d;
    if (!state.user) applyUser(d.user);
    else applyUser(d.user);
    renderView();
    if (showNotice) showToast('Workspace refreshed', 'Project and invoice records are up to date.');
  }

  function navigate(view) {
    state.view = view;
    renderView();
    closeMobileNav();
  }

  function openInvoiceDialog() {
    if (!['admin','project_manager'].includes(state.user.role)) {
      showToast('Access restricted', 'Only administrators and project managers can create invoices.', true);
      return;
    }
    const select = document.getElementById('invoice-project');
    select.innerHTML = state.dashboard.projects.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.code)} — ${escapeHtml(p.name)}</option>`).join('');
    if (!state.dashboard.projects.length) { showToast('No projects available', 'There are no projects in your current access scope.', true); return; }
    populateRecipientFromProject();
    document.getElementById('invoice-mode-note').innerHTML = state.config.paypal_configured
      ? '<span>ⓘ</span><span>PayPal Sandbox is configured. Creating this invoice will call PayPal, send the invoice, and retrieve its payer link.</span>'
      : '<span>ⓘ</span><span>Demo mode records the workflow locally. No invoice email or payment is sent unless PayPal Sandbox credentials are configured.</span>';
    invoiceDialog.showModal();
  }

  function populateRecipientFromProject() {
    const project = projectById(document.getElementById('invoice-project').value);
    if (!project) return;
    document.getElementById('invoice-recipient').value = project.client_name || '';
    document.getElementById('invoice-email').value = project.client_email || '';
    document.getElementById('invoice-description').value = `Progress billing — ${project.stage || 'construction milestone'}`;
  }

  function openProjectDialog(projectId) {
    const p = projectById(projectId);
    if (!p) { showToast('Project unavailable', 'The selected project is outside your current access scope.', true); return; }
    const relatedInvoices = state.dashboard.invoices.filter(i => i.project_id === projectId);
    const upcomingMilestones = state.dashboard.milestones.filter(m => m.project_id === projectId);
    const reasons = [];
    if (p.overdue_invoice_count) reasons.push(`${p.overdue_invoice_count} client invoice(s) overdue.`);
    if (p.projected_variance_pct > 2) reasons.push(`Projected final cost is ${p.projected_variance_pct.toFixed(1)}% above budget.`);
    if (p.schedule_slip_days > 0) reasons.push(`Current progress trend estimates completion ${p.schedule_slip_days} days after target.`);
    projectDialog.innerHTML = `<form method="dialog" class="dialog-close-form"><button class="icon-button" aria-label="Close dialog">×</button></form><div class="project-detail-head"><div><div class="page-kicker">${escapeHtml(p.code)} · ${escapeHtml(p.stage)}</div><h2>${escapeHtml(p.name)}</h2><p>${escapeHtml(p.client_name)} · ${escapeHtml(p.location)}</p></div>${riskChip(p.risk_level)}</div><div class="project-detail-body"><div class="detail-metrics"><div class="detail-metric"><small>Budget</small><strong>${money(p.budget)}</strong></div><div class="detail-metric"><small>Actual cost</small><strong>${money(p.actual_cost)}</strong></div><div class="detail-metric"><small>Forecast final cost</small><strong>${money(p.projected_final_cost)}</strong></div></div><div class="detail-progress-labels"><span>Recorded progress</span><strong>${pct(p.progress_pct)}</strong></div><div class="detail-progress"><span style="width:${Math.min(100,p.progress_pct)}%"></span></div><div class="detail-progress-labels"><span>Target: ${fullDate(p.target_completion)}</span><span>Forecast: ${fullDate(p.predicted_finish)}</span></div><h3 class="detail-section-title">Why this project is flagged</h3>${reasons.length ? reasons.map(r=>`<div class="detail-reason">${escapeHtml(r)}</div>`).join('') : '<div class="detail-reason">No elevated signal from the current rule thresholds.</div>'}<h3 class="detail-section-title">Invoices in your view</h3>${relatedInvoices.length ? relatedInvoices.map(i=>`<div class="detail-reason"><strong>${escapeHtml(i.invoice_number)} · ${money(i.amount)}</strong><br>${escapeHtml(i.description)} · ${escapeHtml(cap(i.status))} · due ${fullDate(i.due_date)}</div>`).join('') : '<div class="detail-reason">No invoices visible for this project and role.</div>'}<h3 class="detail-section-title">Current forecast assumptions</h3><div class="detail-reason">Signal confidence: <strong>${p.confidence_score}%</strong>. This reflects sample count and completeness, not a calibrated probability of risk. Forecasts use synthetic snapshots for prototype evaluation.</div><div class="dialog-actions"><button type="button" class="button button-outline" data-action="close-project">Close</button>${relatedInvoices.some(i=>i.status!=='PAID') ? `<button type="button" class="button button-primary" data-action="go-invoices">View invoices →</button>`:''}</div></div>`;
    projectDialog.showModal();
  }

  async function refreshAI() {
    try {
      const button = viewRoot.querySelector('[data-action="refresh-ai"]');
      if (button) { button.disabled = true; button.textContent = 'Generating…'; }
      const result = await api('/api/intelligence/refresh', { method: 'POST' });
      state.intelligence = result;
      navigate('intelligence');
      if (result.ai_generated) showToast('Gemini analysis generated', 'AI narratives were generated from MaplePro’s calculated evidence.');
      else showToast('Rule-based intelligence refreshed', result.notice || 'Gemini is not connected; no model-generated text was produced.');
    } catch (err) { showToast('Could not refresh intelligence', err.message, true); }
  }

  async function handleAction(action, id, element) {
    if (action === 'new-invoice') { openInvoiceDialog(); return; }
    if (action === 'refresh-dashboard') { await reloadDashboard(true); return; }
    if (action === 'refresh-ai') { await refreshAI(); return; }
    if (action === 'view-project') { openProjectDialog(id); return; }
    if (action === 'close-project') { projectDialog.close(); return; }
    if (action === 'go-invoices') { projectDialog.close(); navigate('invoices'); return; }
    if (action === 'open-invoice') {
      const url = element?.dataset.url;
      if (!url) return;
      if (!url.startsWith('https://')) { showToast('Invoice link blocked', 'Only HTTPS PayPal invoice links may be opened.', true); return; }
      window.open(url, '_blank', 'noopener,noreferrer'); return;
    }
    if (action === 'remind') {
      const button = element;
      if (button) { button.disabled = true; button.textContent = 'Sending…'; }
      try {
        const result = await api(`/api/invoices/${encodeURIComponent(id)}/remind`, { method: 'POST' });
        await reloadDashboard(false);
        showToast(result.real_paypal ? 'PayPal reminder sent' : 'Demo reminder recorded', result.message);
      } catch (err) { if (button) { button.disabled = false; button.textContent = 'Remind'; } showToast('Reminder failed', err.message, true); }
      return;
    }
    if (action === 'simulate-payment') {
      const ok = window.confirm('Simulate this invoice being paid in MaplePro demo data? This does not create a PayPal transaction.');
      if (!ok) return;
      if (element) { element.disabled = true; element.textContent = 'Updating…'; }
      try {
        const result = await api(`/api/invoices/${encodeURIComponent(id)}/simulate-payment`, { method: 'POST' });
        await reloadDashboard(false);
        showToast('Demo payment state updated', result.message);
      } catch (err) { showToast('Payment update failed', err.message, true); }
    }
  }

  async function handleInvoiceSubmit(event) {
    event.preventDefault();
    const submit = document.getElementById('submit-invoice');
    submit.disabled = true; submit.textContent = 'Creating…';
    const body = {
      project_id: document.getElementById('invoice-project').value,
      recipient_name: document.getElementById('invoice-recipient').value.trim(),
      recipient_email: document.getElementById('invoice-email').value.trim(),
      description: document.getElementById('invoice-description').value.trim(),
      amount: Number(document.getElementById('invoice-amount').value),
      currency_code: 'CAD', due_in_days: Number(document.getElementById('invoice-due').value),
    };
    try {
      const result = await api('/api/invoices', { method: 'POST', body: JSON.stringify(body) });
      invoiceDialog.close();
      await reloadDashboard(false);
      navigate('invoices');
      showToast(result.real_paypal ? 'Invoice sent through PayPal' : 'Demo invoice created', result.message);
      if (result.payer_url && result.real_paypal) {
        const openIt = window.confirm('PayPal returned a payer invoice link. Open it in a new tab?');
        if (openIt && result.payer_url.startsWith('https://')) window.open(result.payer_url, '_blank', 'noopener,noreferrer');
      }
      document.getElementById('invoice-form').reset();
    } catch (err) { showToast('Could not create invoice', err.message, true); }
    finally { submit.disabled = false; submit.innerHTML = 'Create invoice <span>→</span>'; }
  }

  function renderSearchResults(results, term) {
    const items = [];
    if (results.projects?.length) {
      items.push('<div class="search-section-title">Projects</div>');
      results.projects.forEach(p => items.push(`<button class="search-result" data-action="search-project" data-id="${escapeHtml(p.id)}"><span class="search-result-icon">▦</span><span><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.code)} · ${escapeHtml(p.client_name)}</small></span></button>`));
    }
    if (results.invoices?.length) {
      items.push('<div class="search-section-title">Invoices</div>');
      results.invoices.forEach(i => items.push(`<button class="search-result" data-action="search-invoice" data-id="${escapeHtml(i.id)}"><span class="search-result-icon">▤</span><span><strong>${escapeHtml(i.invoice_number)} · ${money(i.amount)}</strong><small>${escapeHtml(i.project_name)} · ${escapeHtml(i.recipient_name)}</small></span></button>`));
    }
    searchPopover.innerHTML = items.length ? items.join('') : `<div class="search-empty">No results for “${escapeHtml(term)}”</div>`;
    searchPopover.hidden = false;
  }

  function closeMobileNav() {
    document.getElementById('app-sidebar').classList.remove('open');
    document.getElementById('sidebar-scrim').classList.remove('open');
  }

  document.addEventListener('click', async event => {
    const searchProject = event.target.closest('[data-action="search-project"]');
    if (searchProject) { event.preventDefault(); searchPopover.hidden = true; searchInput.value = ''; navigate('projects'); openProjectDialog(searchProject.dataset.id); return; }
    const searchInvoice = event.target.closest('[data-action="search-invoice"]');
    if (searchInvoice) { event.preventDefault(); searchPopover.hidden = true; searchInput.value = ''; state.invoiceFilter = 'all'; navigate('invoices'); requestAnimationFrame(() => document.querySelector(`[data-invoice-row="${CSS.escape(searchInvoice.dataset.id)}"]`)?.scrollIntoView({ behavior:'smooth', block:'center' })); return; }
    const nav = event.target.closest('[data-view]');
    if (nav) { navigate(nav.dataset.view); return; }
    const actionEl = event.target.closest('[data-action]');
    if (actionEl) { event.preventDefault(); await handleAction(actionEl.dataset.action, actionEl.dataset.id, actionEl); return; }
    if (!event.target.closest('.global-search')) searchPopover.hidden = true;
  });

  document.getElementById('theme-toggle').addEventListener('click', () => setTheme(shell.dataset.theme === 'dark' ? 'light' : 'dark'));
  document.getElementById('mobile-menu').addEventListener('click', () => {
    document.getElementById('app-sidebar').classList.add('open');
    document.getElementById('sidebar-scrim').classList.add('open');
  });
  document.getElementById('sidebar-close').addEventListener('click', closeMobileNav);
  document.getElementById('sidebar-scrim').addEventListener('click', closeMobileNav);
  document.getElementById('sign-out').addEventListener('click', async () => {
    try {
      if (state.config.auth_mode === 'supabase' && window.supabase) {
        const client = window.supabase.createClient(state.config.supabase_url, state.config.supabase_anon_key);
        const currentToken = sessionStorage.getItem('maplepro_token');
        const refreshToken = sessionStorage.getItem('maplepro_refresh_token');
        if (currentToken && refreshToken) await client.auth.setSession({ access_token: currentToken, refresh_token: refreshToken });
        await client.auth.signOut();
      }
    } catch (_) {}
    sessionStorage.removeItem('maplepro_token');
    sessionStorage.removeItem('maplepro_refresh_token');
    window.location.href = '/login';
  });
  document.getElementById('cancel-invoice').addEventListener('click', () => invoiceDialog.close());
  document.getElementById('invoice-form').addEventListener('submit', handleInvoiceSubmit);
  document.getElementById('invoice-project').addEventListener('change', populateRecipientFromProject);
  viewRoot.addEventListener('change', event => {
    if (event.target.id === 'project-risk-filter') { state.projectFilter = event.target.value; renderView(); }
    if (event.target.id === 'invoice-status-filter') { state.invoiceFilter = event.target.value; renderView(); }
  });
  searchInput.addEventListener('input', () => {
    clearTimeout(state.searchTimer);
    const term = searchInput.value.trim();
    if (term.length < 2) { searchPopover.hidden = true; return; }
    state.searchTimer = setTimeout(async () => {
      try { const results = await api(`/api/search?q=${encodeURIComponent(term)}`); renderSearchResults(results, term); }
      catch (_) { searchPopover.hidden = true; }
    }, 220);
  });
  searchInput.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchInput.focus(); }
    if (event.key === 'Escape') { searchPopover.hidden = true; searchInput.blur(); }
    if (event.key === 'Enter') { const first = searchPopover.querySelector('button'); if (first) first.click(); }
  });
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchInput.focus(); }
  });

  async function init() {
    setTheme(localStorage.getItem('maplepro_theme') || 'light');
    try {
      state.config = await fetch('/api/config').then(r => r.json());
      const d = await api('/api/dashboard');
      state.dashboard = d;
      state.user = d.user;
      applyUser(d.user);
      state.intelligence = { mode:'rules_fallback', ai_generated:false, executive_summary: state.config.gemini_configured ? 'Use Generate with Gemini Flash to get a contextual executive brief.' : 'Gemini is not connected yet. The cards below are generated from transparent rules and trend-based forecasts.', insights:d.insights, notice: state.config.gemini_configured ? 'Gemini API key is configured; narratives are generated on request.' : 'No model output is fabricated. Configure GEMINI_API_KEY to enable Gemini Flash.' };
      renderView();
    } catch (err) {
      viewRoot.innerHTML = `<div class="empty-state"><strong>Unable to load MaplePro</strong>${escapeHtml(err.message)}<p><a class="button button-outline" href="/login">Return to sign in</a></p></div>`;
    }
  }
  init();
})();
