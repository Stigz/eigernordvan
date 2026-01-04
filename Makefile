.PHONY: build-backend package-backend terraform-init terraform-apply deploy deploy-frontend deploy-all frontend-install frontend-build

LAMBDA_BIN=backend/dist/bootstrap
LAMBDA_ZIP=backend/dist/lambda.zip

build-backend:
	cd backend && GOOS=linux GOARCH=amd64 go build -o dist/bootstrap

package-backend: build-backend
	cd backend/dist && zip -q -j lambda.zip bootstrap

terraform-init:
	cd infra && terraform init

terraform-apply:
	cd infra && terraform apply

deploy: package-backend terraform-init terraform-apply

deploy-frontend: frontend-build
	@FRONTEND_BUCKET=$$(cd infra && terraform output -raw frontend_bucket_name); \
	CLOUDFRONT_DIST=$$(cd infra && terraform output -raw cloudfront_distribution_id); \
	aws s3 sync frontend/dist s3://$$FRONTEND_BUCKET --delete; \
	aws cloudfront create-invalidation --distribution-id $$CLOUDFRONT_DIST --paths "/*"

deploy-all: deploy deploy-frontend

frontend-install:
	cd frontend && npm install

frontend-build:
	cd frontend && npm run build
