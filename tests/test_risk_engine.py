from datetime import date, timedelta
from types import SimpleNamespace
from app.risk import analyze_project, linear_slope


def test_linear_slope_projects_increasing_progress():
    assert round(linear_slope([(0, 10), (1, 20), (2, 30)]), 3) == 10.0


def test_rule_engine_flags_overdue_invoice_and_cost_pressure():
    today = date(2026, 10, 26)
    project = SimpleNamespace(
        id='p-1', name='Test project', code='T-01', budget=100000,
        actual_cost=72000, committed_costs=28000, progress_pct=55,
        target_completion=today + timedelta(days=30),
    )
    snapshots = [
        SimpleNamespace(snapshot_date=today-timedelta(days=60), progress_pct=25, actual_cost=25000, planned_progress_pct=30),
        SimpleNamespace(snapshot_date=today-timedelta(days=30), progress_pct=40, actual_cost=49000, planned_progress_pct=48),
        SimpleNamespace(snapshot_date=today, progress_pct=55, actual_cost=72000, planned_progress_pct=62),
    ]
    invoices = [SimpleNamespace(project_id='p-1', invoice_type='client_invoice', status='OVERDUE', due_date=today-timedelta(days=12), amount=16000, id='i-1')]
    milestones = [SimpleNamespace(planned_date=today+timedelta(days=10), status='Upcoming')]
    result = analyze_project(project, snapshots, invoices, milestones, today=today)
    assert result['risk_score'] > 0
    assert result['overdue_invoice_count'] == 1
    assert result['overdue_invoice_value'] == 16000
    assert result['risk_level'] in {'Low', 'Medium', 'High'}
    assert 0 <= result['confidence_score'] <= 100
    assert result['actions']


def test_paid_invoice_does_not_count_as_overdue():
    today = date(2026, 10, 26)
    project = SimpleNamespace(id='p-2', name='Paid', code='T-02', budget=100000, actual_cost=40000, committed_costs=20000,
                              progress_pct=40, target_completion=today+timedelta(days=60))
    snapshots = [SimpleNamespace(snapshot_date=today-timedelta(days=30), progress_pct=25, actual_cost=25000, planned_progress_pct=25),
                 SimpleNamespace(snapshot_date=today, progress_pct=40, actual_cost=40000, planned_progress_pct=40)]
    invoices = [SimpleNamespace(project_id='p-2', invoice_type='client_invoice', status='PAID', due_date=today-timedelta(days=20), amount=12000, id='i-2')]
    result = analyze_project(project, snapshots, invoices, [], today=today)
    assert result['overdue_invoice_count'] == 0
    assert result['overdue_invoice_value'] == 0
