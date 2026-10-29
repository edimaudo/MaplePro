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
