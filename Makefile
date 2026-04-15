.PHONY: update dev build bump help

help:
	@echo "Available targets:"
	@echo "  update   Update JS and Rust dependencies"
	@echo "  dev      Start Tauri dev server"
	@echo "  build    Build Tauri application"
	@echo "  bump     Bump patch version in tauri.conf.json and commit all changes"

bump:
	@current=$$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' src-tauri/tauri.conf.json | head -1); \
	if [ -z "$$current" ]; then echo "Failed to read current version"; exit 1; fi; \
	new=$$(echo $$current | awk -F. '{printf "%d.%d.%d", $$1, $$2, $$3+1}'); \
	echo "Version: $$current -> $$new"; \
	sed -i '' -E "s/\"version\": \"$$current\"/\"version\": \"$$new\"/" src-tauri/tauri.conf.json; \
	echo ""; \
	echo "Files to be committed:"; \
	git status --short; \
	echo ""; \
	printf "Proceed with commit? [y/N] "; \
	read ans; \
	if [ "$$ans" = "y" ] || [ "$$ans" = "Y" ]; then \
		git add -A && git commit -m "chore: bump version"; \
	else \
		echo "Aborted. Version bump kept in working tree."; \
	fi

update:
	bun run scripts/download-binaries.ts
	bun update
	cd src-tauri && cargo update

dev:
	bunx tauri dev

build:
	bunx tauri build
