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
    assert "window.location.href = mailto" in js
    assert "Email draft opened" in js
    assert "No external email was sent" not in main
