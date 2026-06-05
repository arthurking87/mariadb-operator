UI_DIR ?= $(shell pwd)/ui

##@ UI

.PHONY: ui-install
ui-install: ## Install UI npm dependencies.
	cd $(UI_DIR) && npm install

.PHONY: ui-dev
ui-dev: ## Start UI dev server (API on :3001, Vite on :5173).
	cd $(UI_DIR) && ./start.sh

.PHONY: ui-stop
ui-stop: ## Stop the background UI API server.
	@pkill -f "node server.js" 2>/dev/null && echo "API server stopped" || echo "API server was not running"

.PHONY: ui-build
ui-build: ## Build UI static files to ui/dist/.
	cd $(UI_DIR) && npm run build
