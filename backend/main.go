package main

import (
  "context"
  "encoding/json"
  "errors"
  "fmt"
  "net/http"
  "os"
  "time"

  "github.com/aws/aws-lambda-go/events"
  "github.com/aws/aws-lambda-go/lambda"
  "github.com/aws/aws-sdk-go-v2/config"
  "github.com/aws/aws-sdk-go-v2/service/dynamodb"
  "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
  "github.com/google/uuid"
)

type tripRequest struct {
  UserName string  `json:"user_name"`
  StartKM  float64 `json:"start_km"`
  EndKM    float64 `json:"end_km"`
}

type tripResponse struct {
  ID           string  `json:"id"`
  DeltaKM      float64 `json:"delta_km"`
  TripCostCHF  float64 `json:"trip_cost_chf"`
  EventType    string  `json:"event_type"`
  LoggedAtUTC  string  `json:"timestamp"`
  Confirmation string  `json:"confirmation"`
}

type handler struct {
  tableName string
  db        *dynamodb.Client
}

func main() {
  ctx := context.Background()
  cfg, err := config.LoadDefaultConfig(ctx)
  if err != nil {
    panic(fmt.Errorf("load aws config: %w", err))
  }

  tableName := os.Getenv("TABLE_NAME")
  if tableName == "" {
    panic("TABLE_NAME is required")
  }

  h := &handler{
    tableName: tableName,
    db:        dynamodb.NewFromConfig(cfg),
  }

  lambda.Start(h.handle)
}

func (h *handler) handle(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
  var payload tripRequest
  if err := json.Unmarshal([]byte(request.Body), &payload); err != nil {
    return respondError(http.StatusBadRequest, "invalid json payload"), nil
  }

  if err := validateTrip(payload); err != nil {
    return respondError(http.StatusBadRequest, err.Error()), nil
  }

  deltaKM := payload.EndKM - payload.StartKM
  tripCost := deltaKM * 0.50

  now := time.Now().UTC()
  itemID := uuid.NewString()

  item := map[string]types.AttributeValue{
    "id":             &types.AttributeValueMemberS{Value: itemID},
    "timestamp":      &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
    "user_name":      &types.AttributeValueMemberS{Value: payload.UserName},
    "start_km":       &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", payload.StartKM)},
    "end_km":         &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", payload.EndKM)},
    "delta_km":       &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", deltaKM)},
    "trip_cost_chf":  &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", tripCost)},
    "event_type":     &types.AttributeValueMemberS{Value: "trip_manual"},
    "ledger_comment": &types.AttributeValueMemberS{Value: "Append-only MVP entry. Corrections are new events."},
  }

  _, err := h.db.PutItem(ctx, &dynamodb.PutItemInput{
    TableName: &h.tableName,
    Item:      item,
  })
  if err != nil {
    return respondError(http.StatusInternalServerError, "failed to store trip"), nil
  }

  response := tripResponse{
    ID:           itemID,
    DeltaKM:      deltaKM,
    TripCostCHF:  tripCost,
    EventType:    "trip_manual",
    LoggedAtUTC:  now.Format(time.RFC3339),
    Confirmation: "Trip logged. Thanks for keeping the habit simple.",
  }

  body, _ := json.Marshal(response)
  return events.APIGatewayV2HTTPResponse{
    StatusCode: http.StatusOK,
    Headers: map[string]string{
      "Content-Type": "application/json",
    },
    Body: string(body),
  }, nil
}

func validateTrip(payload tripRequest) error {
  if payload.UserName == "" {
    return errors.New("user_name is required")
  }
  if payload.EndKM <= payload.StartKM {
    return errors.New("end_km must be greater than start_km")
  }
  return nil
}

func respondError(status int, message string) events.APIGatewayV2HTTPResponse {
  body, _ := json.Marshal(map[string]string{"error": message})
  return events.APIGatewayV2HTTPResponse{
    StatusCode: status,
    Headers: map[string]string{
      "Content-Type": "application/json",
    },
    Body: string(body),
  }
}
