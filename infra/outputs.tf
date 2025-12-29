output "api_url" {
  description = "Base URL for the HTTP API."
  value       = aws_apigatewayv2_api.trip_api.api_endpoint
}
