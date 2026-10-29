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
