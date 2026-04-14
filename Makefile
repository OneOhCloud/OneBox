.PHONY: update dev build help

help:
	@echo "Available targets:"
	@echo "  update   Update JS and Rust dependencies"
	@echo "  dev      Start Tauri dev server"
	@echo "  build    Build Tauri application"

update:
	bun run scripts/download-binaries.ts
	bun update
	cd src-tauri && cargo update

dev:
	bunx tauri dev

build:
	bunx tauri build
