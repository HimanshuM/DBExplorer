.PHONY: test test-integration test-race tests

test:
	go test ./...

test-integration:
	go test -tags=integration ./internal/postgres ./internal/service

test-race:
	go test -race ./internal/postgres

tests: test test-integration test-race
