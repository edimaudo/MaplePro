from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_app_has_working_default_font_size_control():
    html = (ROOT / "app" / "static" / "app.html").read_text()
    js = (ROOT / "app" / "static" / "app.js").read_text()
    css = (ROOT / "app" / "static" / "styles.css").read_text()

    assert 'data-font-size="medium"' in html
    assert 'data-font-size="medium" class="active"' in html
    assert "function setFontSize(size)" in js
    assert "button.addEventListener('click', () => setFontSize(button.dataset.fontSize))" in js
    assert "--font-scale" in css
    assert "font-size: calc(12px * var(--font-scale, 1))" in css


def test_intelligence_is_branded_as_maplepro_intelligence_without_ai_badge():
    html = (ROOT / "app" / "static" / "app.html").read_text()
    js = (ROOT / "app" / "static" / "app.js").read_text()

    assert "MaplePro Intelligence" in html
    assert "MaplePro Intelligence" in js
    assert 'class="nav-new">AI</span>' not in html
    assert "AI intelligence" not in html
    assert "AI intelligence" not in js


def test_forecasts_reports_are_organized_with_accessible_tabs():
    js = (ROOT / "app" / "static" / "app.js").read_text()
    css = (ROOT / "app" / "static" / "styles.css").read_text()

    assert 'data-report-tab="${id}"' in js
    assert "'Cost forecast'" in js
    assert "'Schedule outlook'" in js
    assert "'Receivables'" in js
    assert 'role="tablist"' in js
    assert "event.key === 'ArrowRight'" in js
    assert '.report-tabs' in css


def test_intelligence_cards_use_full_width_and_inter_typography():
    css = (ROOT / "app" / "static" / "styles.css").read_text()
    html = (ROOT / "app" / "static" / "app.html").read_text()

    assert "family=Inter" in html
    assert ".workspace-page, .workspace-page * { font-family: 'Inter'" in css
    assert (".intelligence-list .insight-card,\n" + ".intelligence-feature-card .insight-card { grid-template-columns: minmax(0, 1fr) !important;") in css
    assert ".intelligence-feature-card { display: flex; flex-direction: column;" in css


def test_requested_text_size_ratios_are_applied():
    js = (ROOT / "app" / "static" / "app.js").read_text()
    css = (ROOT / "app" / "static" / "styles.css").read_text()
    assert "small: 0.75, medium: 1, large: 1.25" in js
    assert "data-font-size='small'] { --font-scale: .75; }" in css
    assert "data-font-size='medium'] { --font-scale: 1; }" in css
    assert "data-font-size='large'] { --font-scale: 1.25; }" in css


def test_invoice_register_is_paginated_and_simulate_action_is_removed():
    js = (ROOT / "app" / "static" / "app.js").read_text()
    assert "invoicePageSize: 10" in js
    assert "data-invoice-page" in js
    assert "simulate-payment" not in js
    assert "Demo actions are clearly marked" not in js


def test_reminder_composer_opens_an_editable_email_draft():
    html = (ROOT / "app" / "static" / "app.html").read_text()
    js = (ROOT / "app" / "static" / "app.js").read_text()
    assert 'id="reminder-dialog"' in html
    assert 'id="reminder-message"' in js
    assert "mailto:${encodeURIComponent(to).replace" in js
    assert "draftLink.click()" in js
    assert 'id="copy-reminder"' in js
    assert "Demo reminder recorded" not in js


def test_intelligence_and_command_center_use_accessible_tabs():
    js = (ROOT / "app" / "static" / "app.js").read_text()
    assert 'data-overview-tab="${id}"' in js or "data-overview-tab=" in js
    assert 'data-intelligence-tab="${id}"' in js or "data-intelligence-tab=" in js
    assert "moveInsightToNextSteps" in js
    assert "Next steps" in js


def test_project_invoice_action_preserves_project_scope():
    js = (ROOT / "app" / "static" / "app.js").read_text()
    assert "state.invoiceProjectFilter = id || null" in js
    assert "i.project_id === state.invoiceProjectFilter" in js


def test_user_facing_application_copy_omits_demo_and_simulation_language():
    static = ROOT / "app" / "static"
    app_js = (static / "app.js").read_text()
    login_html = (static / "login.html").read_text()
    assert "Demo actions are clearly marked" not in app_js
    assert "Demo reminder recorded" not in app_js
    assert "simulate-payment" not in app_js
    assert "OR TRY A DEMO ROLE" not in login_html
    assert "demo-divider" not in login_html


def test_command_center_panels_are_in_tabs_not_all_rendered_at_once():
    js = (ROOT / "app" / "static" / "app.js").read_text()
    assert 'data-overview-tab="${id}"' in js
    assert "const selected = tabs.some(([id]) => id === state.overviewTab)" in js
    assert 'data-overview-tab="${id}"' in js


def test_reminder_uses_email_draft_instead_of_recording_a_fake_send():
    js = (ROOT / "app" / "static" / "app.js").read_text()
    main = (ROOT / "app" / "main.py").read_text()
    assert "draftLink.click()" in js
    assert "Reminder prepared" in js
    assert "No external email was sent" not in main



def test_workspace_switcher_and_technical_database_labels_are_removed():
    html = (ROOT / "app" / "static" / "app.html").read_text()
    js = (ROOT / "app" / "static" / "app.js").read_text()
    assert 'class="workspace-switcher"' not in html
    assert "Supabase Data API" not in js
    assert "Connected services" not in js


def test_paypal_workflow_is_explained_in_business_language():
    js = (ROOT / "app" / "static" / "app.js").read_text()
    assert "How PayPal is used" in js
    assert "Invoice delivery" in js
    assert "Client payment" in js
    assert "Payment updates" in js
    assert "PayPal invoicing and payments" in js
    assert "When PayPal is connected, MaplePro creates and sends the client invoice through PayPal." in js


def test_critical_path_action_opens_editable_milestone_planner():
    html = (ROOT / "app" / "static" / "app.html").read_text()
    js = (ROOT / "app" / "static" / "app.js").read_text()
    main = (ROOT / "app" / "main.py").read_text()
    assert 'id="replan-dialog"' in html
    assert 'data-action="replan-critical-path"' in js
    assert "data-replan-milestone" in js
    assert "/api/projects/${encodeURIComponent(projectId)}/replan" in js
    assert '@app.post("/api/projects/{project_id}/replan")' in main


def test_toasts_use_inter_and_do_not_render_tick_icons():
    js = (ROOT / "app" / "static" / "app.js").read_text()
    css = (ROOT / "app" / "static" / "styles.css").read_text()
    assert 'toast.innerHTML = `<div class="toast-copy">' in js
    assert ".toast-icon" not in css
    assert ".toast { display:block;" in css
    assert ".toast {" in css and "font-family:'Inter',Arial,sans-serif !important" in css



def test_actioned_intelligence_uses_the_same_key_for_next_steps():
    js = (ROOT / "app" / "static" / "app.js").read_text()
    assert "const taskKey = insight => insight.project_id || insight.id" in js


def test_project_dialog_exposes_replan_action_to_managers():
    js = (ROOT / "app" / "static" / "app.js").read_text()
    assert 'data-action="replan-critical-path" data-id="${escapeHtml(projectId)}"' in js


def test_paypal_webhook_status_is_distinct_from_invoice_credentials():
    main = (ROOT / "app" / "main.py").read_text()
    js = (ROOT / "app" / "static" / "app.js").read_text()
    assert '"paypal_webhook_configured": bool(settings.paypal_webhook_id)' in main
    assert "state.config.paypal_webhook_configured" in js



def test_reminder_and_milestone_actions_are_restricted_to_managers_in_insights():
    js = (ROOT / "app" / "static" / "app.js").read_text()
    assert "const canManageProject = ['admin','project_manager'].includes(state.user?.role)" in js
    assert "insight.invoice_id && canManageProject" in js
    assert "isCriticalPath && canManageProject" in js
