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
