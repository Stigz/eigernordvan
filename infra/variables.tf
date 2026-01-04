variable "aws_region" {
  type        = string
  description = "AWS region to deploy into."
  default     = "eu-central-1"
}

variable "project_name" {
  type        = string
  description = "Project name prefix for AWS resources."
  default     = "van-usage-mvp"
}

variable "dynamodb_table_name" {
  type        = string
  description = "DynamoDB table name for the append-only ledger."
  default     = "van_trip_ledger"
}

variable "lambda_zip_path" {
  type        = string
  description = "Path to the Lambda deployment package zip."
  default     = "../backend/dist/lambda.zip"
}

variable "frontend_build_path" {
  type        = string
  description = "Path to the built frontend assets."
  default     = "../frontend/dist"
}

variable "enable_frontend_public_policy" {
  type        = bool
  description = "Whether to attach a public-read bucket policy for the frontend."
  default     = false
}
