output "api_url" {
  description = "Base URL for the HTTP API."
  value       = aws_apigatewayv2_api.trip_api.api_endpoint
}

output "frontend_url" {
  description = "Public URL for the static frontend website."
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "frontend_bucket_name" {
  description = "Name of the S3 bucket hosting the frontend."
  value       = aws_s3_bucket.frontend_bucket.bucket
}

output "frontend_distribution_id" {
  description = "CloudFront distribution ID for the frontend."
  value       = aws_cloudfront_distribution.frontend.id
}

output "bookings_table_name" {
  description = "Name of the DynamoDB table storing calendar bookings."
  value       = aws_dynamodb_table.bookings.name
}

output "work_table_name" {
  description = "Name of the DynamoDB table storing work planner state."
  value       = aws_dynamodb_table.work_planner.name
}
