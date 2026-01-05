.PHONY: build-backend package-backend terraform-init terraform-apply deploy frontend-install frontend-build frontend-deploy

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
	cd frontend && if [ -f package-lock.json ]; then npm ci; else npm install; fi

frontend-build:
	cd frontend && npm run build

frontend-deploy: terraform-init
	cd frontend && VITE_API_URL=$$(cd ../infra && terraform output -raw api_url) npm run build
	aws s3 sync frontend/dist s3://$$(cd infra && terraform output -raw frontend_bucket_name) --delete
	aws cloudfront create-invalidation --distribution-id $$(cd infra && terraform output -raw frontend_distribution_id) --paths "/*"
