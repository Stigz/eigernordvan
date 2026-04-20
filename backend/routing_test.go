package main

import (
	"testing"

	"github.com/aws/aws-lambda-go/events"
)

func TestNormalizeRoutePath(t *testing.T) {
	tests := []struct {
		name    string
		request events.APIGatewayV2HTTPRequest
		want    string
	}{
		{
			name: "uses raw path when present",
			request: events.APIGatewayV2HTTPRequest{
				RawPath: "/fuel/abc-123",
				RequestContext: events.APIGatewayV2HTTPRequestContext{
					HTTP: events.APIGatewayV2HTTPRequestContextHTTPDescription{Path: "/ignored"},
				},
			},
			want: "/fuel/abc-123",
		},
		{
			name: "falls back to http path",
			request: events.APIGatewayV2HTTPRequest{
				RequestContext: events.APIGatewayV2HTTPRequestContext{
					HTTP: events.APIGatewayV2HTTPRequestContextHTTPDescription{Path: "/trip/open"},
				},
			},
			want: "/trip/open",
		},
		{
			name: "strips stage prefix when present",
			request: events.APIGatewayV2HTTPRequest{
				RawPath:        "/prod/fuel/e6288bb1-8574-44ae-be1d-5c6149a710ea",
				RequestContext: events.APIGatewayV2HTTPRequestContext{Stage: "prod"},
			},
			want: "/fuel/e6288bb1-8574-44ae-be1d-5c6149a710ea",
		},
		{
			name: "normalizes trailing slash",
			request: events.APIGatewayV2HTTPRequest{
				RawPath: "/fuel/abc-123/",
			},
			want: "/fuel/abc-123",
		},
		{
			name:    "returns root for empty path",
			request: events.APIGatewayV2HTTPRequest{},
			want:    "/",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizeRoutePath(tt.request); got != tt.want {
				t.Fatalf("normalizeRoutePath() = %q, want %q", got, tt.want)
			}
		})
	}
}
