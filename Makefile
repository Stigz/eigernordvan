.PHONY: build-backend package-backend terraform-init terraform-apply deploy frontend-install frontend-build

LAMBDA_BIN=backend/dist/bootstrap
LAMBDA_ZIP=backend/dist/lambda.zip

build-backend:
	cd backend && GOOS=linux GOARCH=amd64 go build -o dist/bootstrap

package-backend: build-backend
	cd backend/dist && zip -q -j lambda.zip bootstrap

terraform-init:
	cd infra && terraform init -upgrade -reconfigure

terraform-apply:
	cd infra && terraform apply

deploy: package-backend terraform-init terraform-apply

frontend-install:
	cd frontend && npm install

frontend-build:
	cd frontend && npm run build
