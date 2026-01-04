output "api_url" {
  description = "Base URL for the HTTP API."
  value       = aws_apigatewayv2_api.trip_api.api_endpoint
}

output "frontend_bucket_name" {
  description = "S3 bucket name for the frontend assets."
  value       = aws_s3_bucket.frontend.bucket
}

output "frontend_url" {
  description = "CloudFront URL for the hosted frontend."
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID for cache invalidations."
  value       = aws_cloudfront_distribution.frontend.id
}
