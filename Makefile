.PHONY: dev test test-integration test-race tests

dev:
	GOTOOLCHAIN=go1.26.2 wails dev

test:
	go test ./...

test-integration:
	go test -tags=integration ./internal/postgres ./internal/service

test-race:
	go test -race ./internal/postgres

tests: test test-integration test-race
