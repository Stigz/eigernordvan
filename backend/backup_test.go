package main

import (
	"reflect"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

func TestDynamoValueToAnyConvertsNestedValues(t *testing.T) {
	value := &types.AttributeValueMemberM{Value: map[string]types.AttributeValue{
		"id":      &types.AttributeValueMemberS{Value: "trip-1"},
		"delta":   &types.AttributeValueMemberN{Value: "12.5"},
		"active":  &types.AttributeValueMemberBOOL{Value: true},
		"receipt": &types.AttributeValueMemberB{Value: []byte("ok")},
		"tags":    &types.AttributeValueMemberSS{Value: []string{"van", "fuel"}},
		"nested": &types.AttributeValueMemberL{Value: []types.AttributeValue{
			&types.AttributeValueMemberNULL{Value: true},
			&types.AttributeValueMemberN{Value: "7"},
		}},
	}}

	got := dynamoValueToAny(value)
	want := map[string]any{
		"id":      "trip-1",
		"delta":   12.5,
		"active":  true,
		"receipt": "b2s=",
		"tags":    []string{"van", "fuel"},
		"nested":  []any{nil, 7.0},
	}

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected converted value:\n got %#v\nwant %#v", got, want)
	}
}
