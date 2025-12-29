.PHONY: build-backend package-backend terraform-init terraform-apply deploy frontend-install frontend-build

LAMBDA_BIN=backend/dist/main
LAMBDA_ZIP=backend/dist/lambda.zip

build-backend:
	cd backend && GOOS=linux GOARCH=amd64 go build -o dist/main

package-backend: build-backend
	cd backend/dist && zip -q -j lambda.zip main

terraform-init:
	cd infra && terraform init

terraform-apply:
	cd infra && terraform apply

deploy: package-backend terraform-init terraform-apply

frontend-install:
	cd frontend && npm install

frontend-build:
	cd frontend && npm run build
