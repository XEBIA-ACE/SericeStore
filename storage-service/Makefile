.PHONY: install dev-install lint format typecheck test test-unit test-integration \
        docker-build docker-up docker-down clean

# ── Setup ─────────────────────────────────────────────────────────────────────
install:
	pip install -r requirements.txt

dev-install:
	pip install -r requirements.txt -r requirements-dev.txt

# ── Code quality ──────────────────────────────────────────────────────────────
lint:
	ruff check src tests

format:
	ruff format src tests

typecheck:
	mypy src

security:
	bandit -r src -ll

# ── Testing ───────────────────────────────────────────────────────────────────
test:
	pytest

test-unit:
	pytest tests/unit -m unit

test-integration:
	pytest tests/integration -m integration

test-no-cov:
	pytest --no-cov

# ── Docker ────────────────────────────────────────────────────────────────────
docker-build:
	docker build -t storage-service:latest .

docker-up:
	docker compose up -d

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f app

# ── Run locally ───────────────────────────────────────────────────────────────
run:
	python -m uvicorn src.main:app --reload --port 8000

# ── Cleanup ───────────────────────────────────────────────────────────────────
clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null; true
	find . -type f -name "*.pyc" -delete
	rm -rf .pytest_cache htmlcov .coverage .mypy_cache
