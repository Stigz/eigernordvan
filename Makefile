.PHONY: build-backend package-backend terraform-init terraform-apply terraform-apply-ci deploy deploy-ci frontend-install frontend-build frontend-deploy

LAMBDA_BIN=backend/dist/bootstrap
LAMBDA_ZIP=backend/dist/lambda.zip
TF_BACKEND_KEY ?= eigernordvan/terraform.tfstate
TF_BACKEND_REGION ?= $(if $(AWS_REGION),$(AWS_REGION),eu-central-1)

build-backend:
	cd backend && GOOS=linux GOARCH=amd64 go build -o dist/bootstrap

package-backend: build-backend
	cd backend/dist && zip -q -j lambda.zip bootstrap

terraform-init:
	@test -n "$(TF_BACKEND_BUCKET)" || (echo "TF_BACKEND_BUCKET is required. Set it to the S3 bucket that stores Terraform state." >&2; exit 1)
	cd infra && terraform init -upgrade -reconfigure \
		-backend-config="bucket=$(TF_BACKEND_BUCKET)" \
		-backend-config="key=$(TF_BACKEND_KEY)" \
		-backend-config="region=$(TF_BACKEND_REGION)" \
		-backend-config="encrypt=true"

terraform-apply:
	cd infra && terraform apply

terraform-apply-ci:
	cd infra && terraform apply -auto-approve

deploy: package-backend terraform-init terraform-apply frontend-deploy

deploy-ci: package-backend terraform-init terraform-apply-ci frontend-deploy

frontend-install:
	cd frontend && if [ -f package-lock.json ]; then npm ci; else npm install; fi

frontend-build: frontend-install
	cd frontend && npm run build

frontend-deploy: frontend-install
	cd frontend && VITE_API_URL=$$(cd ../infra && terraform output -raw api_url) npm run build
	aws s3 sync frontend/dist s3://$$(cd infra && terraform output -raw frontend_bucket_name) --delete
	aws cloudfront create-invalidation --distribution-id $$(cd infra && terraform output -raw frontend_distribution_id) --paths "/*"
